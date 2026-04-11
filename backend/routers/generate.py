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
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from models.schemas import (
    ApiResponse,
    GenerateRequest,
    GenerateResponse,
)
from services.comfyui_client import comfyui_client
from services.process_manager import process_manager
from services.prompt_engine import prompt_engine
from services.workflow_manager import workflow_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["생성"])

# ─────────────────────────────────────────────
# 인메모리 태스크 관리 (Phase 1 MVP)
# ─────────────────────────────────────────────

_tasks: dict[str, dict[str, Any]] = {}


def _create_task(request: GenerateRequest) -> str:
    """새 태스크 생성 및 ID 반환"""
    task_id = str(uuid.uuid4())[:8]
    _tasks[task_id] = {
        "status": "queued",
        "request": request,
        "prompt_id": None,
        "progress": 0,
        "images": [],
        "error": None,
        "enhanced_prompt": None,
        "negative_prompt": None,
    }
    return task_id


# ─────────────────────────────────────────────
# 백그라운드 생성 워커
# ─────────────────────────────────────────────

async def _run_generation(task_id: str) -> None:
    """
    백그라운드에서 이미지 생성 전체 파이프라인 실행
    REST 핸들러와 분리되어 즉시 응답 가능
    """
    task = _tasks[task_id]
    request: GenerateRequest = task["request"]

    try:
        # 1단계: ComfyUI 확인/시작
        task["status"] = "warming_up"
        comfyui_running = await process_manager.check_comfyui()
        if not comfyui_running:
            started = await process_manager.start_comfyui()
            if not started:
                task["status"] = "error"
                task["error"] = "ComfyUI를 시작할 수 없습니다. 설치 경로를 확인해주세요."
                return

        # 비활동 타이머 리셋
        process_manager.reset_activity_timer()

        # 2단계: 프롬프트 보강
        enhanced = request.prompt
        negative = request.negative_prompt
        if request.auto_enhance:
            task["status"] = "enhancing"
            try:
                result = await prompt_engine.enhance_prompt(request.prompt)
                enhanced = result.enhanced
                negative = negative or result.negative
                task["enhanced_prompt"] = enhanced
                task["negative_prompt"] = negative
            except Exception as exc:
                logger.warning("프롬프트 보강 실패, 원본 사용: %s", exc)

        # 3단계: 워크플로우 빌드
        try:
            wf = workflow_manager.load_workflow(request.mode)
        except FileNotFoundError:
            wf = workflow_manager.load_workflow("txt2img")

        request_copy = request.model_copy(
            update={"prompt": enhanced, "negative_prompt": negative}
        )
        prompt_payload = workflow_manager.build_prompt(request_copy, wf)

        # 4단계: ComfyUI에 큐잉
        task["status"] = "generating"
        result = await comfyui_client.queue_prompt(prompt_payload, task_id)
        task["prompt_id"] = result.get("prompt_id")

        logger.info(
            "태스크 %s: 생성 큐잉 완료 (prompt_id=%s)",
            task_id, task["prompt_id"],
        )

    except Exception as exc:
        task["status"] = "error"
        task["error"] = f"생성 파이프라인 오류: {exc}"
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
    task_id = _create_task(request)

    # 백그라운드 태스크로 생성 파이프라인 실행
    asyncio.create_task(_run_generation(task_id))

    return {
        "success": True,
        "data": GenerateResponse(
            task_id=task_id,
            status="queued",
        ),
    }


@router.post("/api/generate/cancel/{task_id}", response_model=ApiResponse[dict])
async def cancel_generation(task_id: str):
    """생성 중인 태스크 취소"""
    task = _tasks.get(task_id)
    if task is None:
        return {
            "success": False,
            "data": {},
            "error": "존재하지 않는 태스크입니다.",
        }

    if task["status"] not in ("queued", "warming_up", "enhancing", "generating"):
        return {
            "success": False,
            "data": {},
            "error": f"취소할 수 없는 상태입니다: {task['status']}",
        }

    # ComfyUI interrupt 호출
    interrupted = await comfyui_client.interrupt()
    task["status"] = "cancelled"

    return {
        "success": True,
        "data": {
            "task_id": task_id,
            "interrupted": interrupted,
            "message": "생성이 취소되었습니다.",
        },
    }


@router.get("/api/generate/status/{task_id}", response_model=ApiResponse[dict])
async def get_task_status(task_id: str):
    """태스크 상태 조회"""
    task = _tasks.get(task_id)
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
            "status": task["status"],
            "progress": task["progress"],
            "images": task["images"],
            "error": task["error"],
            "enhanced_prompt": task["enhanced_prompt"],
            "negative_prompt": task["negative_prompt"],
        },
    }


# ─────────────────────────────────────────────
# WebSocket 진행률 스트리밍
# ─────────────────────────────────────────────

@router.websocket("/api/ws/generate")
async def ws_generate(websocket: WebSocket):
    """
    WebSocket으로 생성 전체 라이프사이클 스트리밍
    1. 클라이언트 연결 → task_id 수신
    2. 태스크 상태 변화 폴링 (warming_up → enhancing → generating)
    3. ComfyUI WS 연결 → 진행률 릴레이
    4. 이미지 다운로드 → completed 전송
    """
    await websocket.accept()
    logger.info("WebSocket 클라이언트 연결")

    try:
        while True:
            # 클라이언트로부터 태스크 ID 수신
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json(
                    {"type": "error", "message": "잘못된 JSON 형식입니다."}
                )
                continue

            task_id = msg.get("task_id")
            if not task_id or task_id not in _tasks:
                await websocket.send_json(
                    {"type": "error", "message": "유효하지 않은 태스크 ID입니다."}
                )
                continue

            task = _tasks[task_id]

            # ── 단계 1: 태스크가 generating 상태가 될 때까지 폴링 ──
            for _ in range(300):  # 최대 150초 대기
                status = task["status"]

                # 에러/취소면 즉시 알림
                if status in ("error", "cancelled"):
                    await websocket.send_json({
                        "type": "error" if status == "error" else "cancelled",
                        "task_id": task_id,
                        "message": task.get("error", "생성이 취소되었습니다."),
                    })
                    break

                # 현재 상태 전송
                await websocket.send_json({
                    "type": "status",
                    "task_id": task_id,
                    "status": status,
                    "progress": 0,
                    "enhanced_prompt": task.get("enhanced_prompt"),
                    "negative_prompt": task.get("negative_prompt"),
                })

                # prompt_id가 설정되었으면 ComfyUI WS 단계로 이동
                if task.get("prompt_id"):
                    break

                await asyncio.sleep(0.5)
            else:
                await websocket.send_json({
                    "type": "error",
                    "task_id": task_id,
                    "message": "생성 준비 타임아웃",
                })
                continue

            # 에러/취소로 종료된 경우 다음 메시지 대기
            if task["status"] in ("error", "cancelled"):
                continue

            prompt_id = task["prompt_id"]

            # ── 단계 2: ComfyUI WebSocket으로 생성 진행률 수신 ──
            try:
                async for ws_msg in comfyui_client.connect_ws(task_id):
                    msg_type = ws_msg.get("type", "")

                    if msg_type == "progress":
                        progress = ws_msg.get("data", {})
                        current = progress.get("value", 0)
                        total = progress.get("max", 1)
                        pct = int((current / total) * 100) if total > 0 else 0
                        task["progress"] = pct
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
                        task["status"] = "error"
                        task["error"] = error_msg
                        await websocket.send_json({
                            "type": "error",
                            "task_id": task_id,
                            "message": error_msg,
                        })
                        break

            except Exception as exc:
                logger.error("ComfyUI WS 스트리밍 오류: %s", exc)
                await websocket.send_json({
                    "type": "error",
                    "task_id": task_id,
                    "message": f"진행률 수신 오류: {exc}",
                })
                continue

            # ── 단계 3: 이미지 다운로드 및 완료 전송 ──
            if task["status"] != "error":
                try:
                    saved = await comfyui_client.download_and_save_images(
                        prompt_id
                    )
                    task["images"] = saved
                    task["status"] = "completed"
                    task["progress"] = 100
                    await websocket.send_json({
                        "type": "completed",
                        "task_id": task_id,
                        "images": saved,
                    })
                except Exception as exc:
                    logger.error("이미지 다운로드 실패: %s", exc)
                    task["status"] = "error"
                    task["error"] = f"이미지 저장 실패: {exc}"
                    await websocket.send_json({
                        "type": "error",
                        "task_id": task_id,
                        "message": f"이미지 저장 실패: {exc}",
                    })

    except WebSocketDisconnect:
        logger.info("WebSocket 클라이언트 연결 해제")
    except Exception as exc:
        logger.error("WebSocket 오류: %s", exc)
