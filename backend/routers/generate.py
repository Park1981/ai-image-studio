"""
이미지 생성 라우터
- POST /api/generate: 태스크 생성 (즉시 응답) + 백그라운드 처리
- POST /api/generate/cancel/{task_id}: 생성 취소
- WebSocket /api/ws/generate: 실시간 진행률
"""

import asyncio
import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, UploadFile, WebSocket, WebSocketDisconnect

from config import settings
from database import save_generation
from models.schemas import (
    ApiResponse,
    EditRequest,
    GenerateRequest,
    GenerateResponse,
)
from services.comfyui_client import comfyui_client
from services.image_path import resolve_image_path
from services.process_manager import process_manager
from services.prompt_engine import prompt_engine
from services.task_manager import Task, task_manager
from services.workflow_manager import workflow_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["생성"])


# ─────────────────────────────────────────────
# ComfyUI 확인/시작 헬퍼
# ─────────────────────────────────────────────

async def _ensure_comfyui(task: Task) -> bool:
    """
    ComfyUI 실행 확인 및 시작.
    성공 시 True, 실패 시 task에 에러 세팅 후 False 반환.
    """
    task.status = "warming_up"
    comfyui_running = await process_manager.check_comfyui()
    if not comfyui_running:
        started = await process_manager.start_comfyui()
        if not started:
            task.status = "error"
            task.error = "ComfyUI를 시작할 수 없습니다. 설치 경로를 확인해주세요."
            return False
    return True


# ─────────────────────────────────────────────
# 백그라운드 생성 워커
# ─────────────────────────────────────────────

async def _run_generation(task_id: str) -> None:
    """
    백그라운드에서 이미지 생성 전체 파이프라인 실행
    REST 핸들러와 분리되어 즉시 응답 가능
    """
    task = await task_manager.get_task(task_id)
    if task is None:
        logger.error("태스크 %s를 찾을 수 없습니다.", task_id)
        return
    request: GenerateRequest = task.request

    try:
        # 1단계: ComfyUI 확인/시작
        if not await _ensure_comfyui(task):
            return

        # 2단계: 프롬프트 보강
        enhanced = request.prompt
        negative = request.negative_prompt
        if request.auto_enhance:
            task.status = "enhancing"
            try:
                result = await prompt_engine.enhance_prompt(request.prompt)
                enhanced = result.enhanced
                negative = negative or result.negative
                task.enhanced_prompt = enhanced
                task.negative_prompt = negative
            except Exception as exc:
                logger.warning("프롬프트 보강 실패, 원본 사용: %s", exc)

        # 3단계: 워크플로우 빌드 (기본: qwen_image)
        try:
            wf = workflow_manager.load_workflow(request.mode)
        except FileNotFoundError:
            wf = workflow_manager.load_workflow("qwen_image")

        request_copy = request.model_copy(
            update={"prompt": enhanced, "negative_prompt": negative}
        )
        prompt_payload = workflow_manager.build_prompt(request_copy, wf)

        # 4단계: ComfyUI에 큐잉
        task.status = "generating"
        result = await comfyui_client.queue_prompt(prompt_payload, task_id)
        task.prompt_id = result.get("prompt_id")

        logger.info(
            "태스크 %s: 생성 큐잉 완료 (prompt_id=%s)",
            task_id, task.prompt_id,
        )

    except Exception as exc:
        task.status = "error"
        task.error = f"생성 파이프라인 오류: {exc}"
        logger.error("태스크 %s 생성 실패: %s", task_id, exc)


# ─────────────────────────────────────────────
# REST 엔드포인트
# ─────────────────────────────────────────────

@router.post("/api/generate", response_model=ApiResponse[GenerateResponse])
async def generate_image(request: GenerateRequest):
    """
    이미지 생성 요청 — 즉시 task_id 반환
    실제 생성은 백그라운드에서 진행, WebSocket으로 진행률 수신
    """
    task = await task_manager.create_task(request, mode="generate")

    # 백그라운드 태스크로 생성 파이프라인 실행
    asyncio.create_task(_run_generation(task.id))

    return {
        "success": True,
        "data": GenerateResponse(
            task_id=task.id,
            status="queued",
        ),
    }


@router.post("/api/generate/cancel/{task_id}", response_model=ApiResponse[dict])
async def cancel_generation(task_id: str):
    """생성 중인 태스크 취소"""
    task = await task_manager.get_task(task_id)
    if task is None:
        return {
            "success": False,
            "data": {},
            "error": "존재하지 않는 태스크입니다.",
        }

    if task.status not in ("queued", "warming_up", "enhancing", "generating"):
        return {
            "success": False,
            "data": {},
            "error": f"취소할 수 없는 상태입니다: {task.status}",
        }

    # ComfyUI interrupt 호출
    interrupted = await comfyui_client.interrupt()
    task.status = "cancelled"

    return {
        "success": True,
        "data": {
            "task_id": task_id,
            "interrupted": interrupted,
            "message": "생성이 취소되었습니다.",
        },
    }


@router.post("/api/images/upload", response_model=ApiResponse[dict])
async def upload_image(file: UploadFile):
    """
    이미지 업로드 — 로컬 data/uploads/ 에 저장 후 파일 정보 반환
    이미지 수정(edit) 모드의 소스 이미지 업로드에 사용
    """
    if not file.filename:
        return {
            "success": False,
            "data": {},
            "error": "파일이 선택되지 않았습니다.",
        }

    # 안전한 파일명 생성 (UUID 접두사로 충돌 방지)
    safe_name = Path(file.filename).name
    unique_name = f"{uuid.uuid4().hex[:8]}_{safe_name}"

    upload_dir = Path(settings.upload_path)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / unique_name

    try:
        content = await file.read()
        file_path.write_bytes(content)
        logger.info("이미지 업로드 완료: %s (%d bytes)", unique_name, len(content))
        return {
            "success": True,
            "data": {
                "filename": unique_name,
                "size": len(content),
            },
        }
    except Exception as exc:
        logger.error("이미지 업로드 실패: %s", exc)
        return {
            "success": False,
            "data": {},
            "error": f"파일 저장 실패: {exc}",
        }


# ─────────────────────────────────────────────
# 이미지 수정 (Edit) 엔드포인트
# 소스 이미지 경로 해석은 services/image_path.resolve_image_path 사용
# ─────────────────────────────────────────────

async def _run_edit_generation(task_id: str) -> None:
    """
    백그라운드에서 이미지 수정 파이프라인 실행
    1. ComfyUI 확인/시작
    2. 소스 이미지를 ComfyUI에 업로드
    3. 수정 워크플로우 빌드
    4. ComfyUI에 큐잉
    """
    task = await task_manager.get_task(task_id)
    if task is None:
        logger.error("수정 태스크 %s를 찾을 수 없습니다.", task_id)
        return
    request: EditRequest = task.request

    try:
        # 1단계: ComfyUI 확인/시작
        if not await _ensure_comfyui(task):
            return

        # 2단계: 소스 이미지를 ComfyUI input 디렉토리에 업로드
        task.status = "generating"
        local_path = resolve_image_path(request.source_image)

        if local_path is None:
            task.status = "error"
            task.error = f"소스 이미지를 찾을 수 없습니다: {request.source_image}"
            return

        comfyui_image_name = await comfyui_client.upload_image(
            str(local_path), local_path.name
        )

        # 2.5단계: AI 프롬프트 보강 (auto_enhance가 True인 경우)
        enhanced_edit_prompt = request.edit_prompt
        enhanced_negative = request.negative_prompt
        if request.auto_enhance:
            task.status = "enhancing"
            try:
                vision_result = await prompt_engine.enhance_prompt_with_vision(
                    prompt=request.edit_prompt,
                    image_path=str(local_path),
                )
                enhanced_edit_prompt = vision_result.enhanced
                enhanced_negative = vision_result.negative
                task.enhanced_prompt = enhanced_edit_prompt
                task.negative_prompt = enhanced_negative
            except Exception as exc:
                logger.warning("수정 모드 프롬프트 보강 실패, 원본 사용: %s", exc)

        # 보강된 프롬프트/네거티브로 요청 업데이트 (build_edit_prompt가 실제 워크플로우에 주입)
        request_copy = request.model_copy(
            update={
                "edit_prompt": enhanced_edit_prompt,
                "negative_prompt": enhanced_negative,
            }
        )

        # 3단계: 수정 워크플로우 빌드
        wf = workflow_manager.load_workflow("qwen_image_edit")
        prompt_payload = workflow_manager.build_edit_prompt(
            request_copy, wf, comfyui_image_name
        )

        # 4단계: ComfyUI에 큐잉
        result = await comfyui_client.queue_prompt(prompt_payload, task_id)
        task.prompt_id = result.get("prompt_id")

        logger.info(
            "수정 태스크 %s: 큐잉 완료 (prompt_id=%s)",
            task_id, task.prompt_id,
        )

    except Exception as exc:
        task.status = "error"
        task.error = f"이미지 수정 파이프라인 오류: {exc}"
        logger.error("수정 태스크 %s 실패: %s", task_id, exc)


@router.post("/api/generate/edit", response_model=ApiResponse[GenerateResponse])
async def generate_edit(request: EditRequest):
    """
    이미지 수정 요청 — 즉시 task_id 반환
    소스 이미지 + 수정 프롬프트로 Qwen Image Edit 실행
    WebSocket으로 진행률 수신 (기존 메커니즘 재활용)
    """
    task = await task_manager.create_task(request, mode="edit")

    # 백그라운드 태스크로 수정 파이프라인 실행
    asyncio.create_task(_run_edit_generation(task.id))

    return {
        "success": True,
        "data": GenerateResponse(
            task_id=task.id,
            status="queued",
        ),
    }


@router.get("/api/generate/status/{task_id}", response_model=ApiResponse[dict])
async def get_task_status(task_id: str):
    """태스크 상태 조회"""
    task = await task_manager.get_task(task_id)
    if task is None:
        return {
            "success": False,
            "data": {},
            "error": "존재하지 않는 태스크입니다.",
        }

    return {
        "success": True,
        "data": {
            "task_id": task_id,
            "status": task.status,
            "progress": task.progress,
            "images": task.images,
            "error": task.error,
            "enhanced_prompt": task.enhanced_prompt,
            "negative_prompt": task.negative_prompt,
        },
    }


# ─────────────────────────────────────────────
# WebSocket 진행률 스트리밍
# ─────────────────────────────────────────────

# 준비 단계 폴링 설정 (매직넘버 상수화)
_WS_PREP_POLL_MAX_ITERATIONS: int = 300  # 최대 반복 (300 * 0.5초 = 150초)
_WS_PREP_POLL_INTERVAL: float = 0.5  # 폴링 간격 (초)


async def _receive_task_id(websocket: WebSocket) -> str | None:
    """WS 클라이언트로부터 task_id 수신. 잘못된 JSON이면 에러 전송 후 None 반환."""
    raw = await websocket.receive_text()
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        await websocket.send_json(
            {"type": "error", "message": "잘못된 JSON 형식입니다."}
        )
        return None
    return msg.get("task_id")


async def _wait_for_prompt_id(
    task: Task,
    task_id: str,
    websocket: WebSocket,
) -> bool:
    """
    백그라운드 태스크의 prompt_id가 설정될 때까지 폴링하며 상태 전송.
    반환: True면 준비 완료, False면 에러/취소/타임아웃 (에러는 이미 전송됨)
    """
    for _ in range(_WS_PREP_POLL_MAX_ITERATIONS):
        status = task.status

        # 에러/취소면 즉시 알림 후 종료
        if status in ("error", "cancelled"):
            await websocket.send_json({
                "type": "error" if status == "error" else "cancelled",
                "task_id": task_id,
                "message": task.error or "생성이 취소되었습니다.",
            })
            return False

        # 현재 상태 전송
        await websocket.send_json({
            "type": "status",
            "task_id": task_id,
            "status": status,
            "progress": 0,
            "enhanced_prompt": task.enhanced_prompt,
            "negative_prompt": task.negative_prompt,
        })

        # prompt_id가 설정됐으면 성공
        if task.prompt_id:
            return True

        await asyncio.sleep(_WS_PREP_POLL_INTERVAL)

    # 타임아웃
    await websocket.send_json({
        "type": "error",
        "task_id": task_id,
        "message": "생성 준비 타임아웃",
    })
    return False


async def _stream_comfyui_progress(
    task: Task,
    task_id: str,
    websocket: WebSocket,
) -> bool:
    """
    ComfyUI WS 메시지를 프론트로 릴레이.
    반환: True면 실행 정상 완료, False면 에러/중단 (에러는 이미 전송됨)
    """
    execution_done = False
    try:
        async for ws_msg in comfyui_client.connect_ws(task_id):
            msg_type = ws_msg.get("type", "")

            if msg_type == "progress":
                progress = ws_msg.get("data", {})
                current = progress.get("value", 0)
                total = progress.get("max", 1)
                pct = int((current / total) * 100) if total > 0 else 0
                task.progress = pct
                await websocket.send_json({
                    "type": "progress",
                    "task_id": task_id,
                    "progress": pct,
                    "current": current,
                    "total": total,
                })

            elif msg_type == "executing":
                node = ws_msg.get("data", {}).get("node")
                if node is None:
                    execution_done = True
                    break  # 실행 완료
                await websocket.send_json({
                    "type": "executing",
                    "task_id": task_id,
                    "node": node,
                })

            elif msg_type == "execution_error":
                error_msg = ws_msg.get("data", {}).get(
                    "exception_message", "알 수 없는 오류"
                )
                task.status = "error"
                task.error = error_msg
                await websocket.send_json({
                    "type": "error",
                    "task_id": task_id,
                    "message": error_msg,
                })
                return False

            elif msg_type == "connection_closed":
                # ComfyUI WS 조기 종료 — execution_done이 아니면 에러 처리
                if not execution_done:
                    error_msg = ws_msg.get("data", {}).get(
                        "message", "ComfyUI 연결이 예기치 않게 종료되었습니다."
                    )
                    task.status = "error"
                    task.error = error_msg
                    await websocket.send_json({
                        "type": "error",
                        "task_id": task_id,
                        "message": error_msg,
                    })
                    return False

    except Exception as exc:
        if not execution_done:
            # WS 스트리밍 중 실제 오류 — 에러 전송 후 실패 반환
            logger.error("ComfyUI WS 스트리밍 오류: %s", exc)
            try:
                await websocket.send_json({
                    "type": "error",
                    "task_id": task_id,
                    "message": f"진행률 수신 오류: {exc}",
                })
            except Exception:
                logger.error("프론트 WS 전송도 실패 — 연결 끊김")
            return False
        # 실행 완료 후 WS 정리 중 예외 — 무시하고 다운로드 단계로
        logger.info("WS 정리 중 예외 (무시): %s", exc)

    return execution_done


async def _persist_history(task: Task, task_id: str, saved: list) -> None:
    """DB에 생성 이력 저장 — to_history_fields()로 모드별 필드 통합 (실패는 경고만)"""
    try:
        fields = task.request.to_history_fields()
        await save_generation(
            generation_id=task_id,
            prompt=fields["prompt"],
            enhanced_prompt=task.enhanced_prompt,
            negative_prompt=task.negative_prompt,
            checkpoint=fields["checkpoint"],
            loras=json.dumps(fields["loras"]),
            sampler=fields["sampler"],
            scheduler=fields["scheduler"],
            width=fields["width"],
            height=fields["height"],
            steps=fields["steps"],
            cfg=fields["cfg"],
            seed=saved[0]["seed"] if saved else fields["seed"],
            images=json.dumps(saved),
        )
        logger.info("태스크 %s: 히스토리 DB 저장 완료", task_id)
    except Exception as db_exc:
        logger.warning("히스토리 DB 저장 실패 (무시): %s", db_exc)


async def _finalize_generation(
    task: Task,
    task_id: str,
    prompt_id: str,
    websocket: WebSocket,
) -> None:
    """이미지 다운로드 + DB 저장 + completed 전송 + 유휴 타이머 시작"""
    try:
        saved = await comfyui_client.download_and_save_images(prompt_id)
        task.images = saved
        task.status = "completed"
        task.progress = 100
        logger.info(
            "태스크 %s: 이미지 %d개 저장 완료, completed 전송 시도",
            task_id, len(saved),
        )
        await websocket.send_json({
            "type": "completed",
            "task_id": task_id,
            "images": saved,
        })
        logger.info("태스크 %s: completed 전송 성공", task_id)

        # DB 저장 + 유휴 타이머
        await _persist_history(task, task_id, saved)
        process_manager.mark_generation_complete()

    except Exception as exc:
        logger.error("이미지 다운로드 실패: %s", exc, exc_info=True)
        task.status = "error"
        task.error = f"이미지 저장 실패: {exc}"
        try:
            await websocket.send_json({
                "type": "error",
                "task_id": task_id,
                "message": f"이미지 저장 실패: {exc}",
            })
        except Exception:
            logger.error("에러 메시지 전송도 실패 — 프론트 WS 끊김")


@router.websocket("/api/ws/generate")
async def ws_generate(websocket: WebSocket):
    """
    WebSocket으로 생성 전체 라이프사이클 스트리밍.
    단계별 헬퍼 함수로 분해되어 복잡도 감소:
    1. _receive_task_id: 클라이언트에서 task_id 수신
    2. _wait_for_prompt_id: 백그라운드 워커의 prompt_id 준비 대기
    3. _stream_comfyui_progress: ComfyUI WS 진행률 릴레이
    4. _finalize_generation: 이미지 다운로드 + DB 저장 + completed 전송
    """
    await websocket.accept()
    logger.info("WebSocket 클라이언트 연결")

    try:
        while True:
            # 1. 태스크 ID 수신 + 유효성 확인
            task_id = await _receive_task_id(websocket)
            if task_id is None:
                continue

            task = await task_manager.get_task(task_id)
            if not task:
                await websocket.send_json(
                    {"type": "error", "message": "유효하지 않은 태스크 ID입니다."}
                )
                continue

            # 2. prompt_id 준비 대기 (warming_up → enhancing → generating)
            if not await _wait_for_prompt_id(task, task_id, websocket):
                continue

            prompt_id = task.prompt_id
            assert prompt_id is not None, "_wait_for_prompt_id=True면 prompt_id 설정됨"

            # 3. ComfyUI 실행 진행률 릴레이
            if not await _stream_comfyui_progress(task, task_id, websocket):
                continue

            logger.info(
                "태스크 %s: WS 스트리밍 완료 (status=%s, prompt_id=%s)",
                task_id, task.status, prompt_id,
            )

            # 4. 이미지 다운로드 + 완료 전송 (에러 상태면 스킵)
            if task.status != "error":
                await _finalize_generation(task, task_id, prompt_id, websocket)

    except WebSocketDisconnect:
        logger.info("WebSocket 클라이언트 연결 해제")
    except Exception as exc:
        logger.error("WebSocket 오류: %s", exc)
