"""
ComfyUI API 통신 클라이언트
- REST API: 프롬프트 큐잉, 히스토리 조회, 이미지 다운로드
- WebSocket: 생성 진행 상황 실시간 수신
- 모델 목록 조회 (체크포인트, LoRA, VAE)
"""

import json
import logging
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import websockets
import websockets.exceptions

from config import settings

logger = logging.getLogger(__name__)

# 타임아웃 설정 (초)
_HEALTH_TIMEOUT: float = 5.0
_GENERATION_TIMEOUT: float = 300.0
# WebSocket 연결 타임아웃 (초)
_WS_CONNECT_TIMEOUT: float = 10.0
# WebSocket 수신 타임아웃 (초) — 생성 중 오래 걸릴 수 있음
_WS_RECEIVE_TIMEOUT: float = 600.0


class ComfyUIClient:
    """ComfyUI REST/WebSocket 클라이언트"""

    def __init__(self) -> None:
        self._base_url: str = settings.comfyui_url
        self._ws_url: str = settings.comfyui_ws_url

    # ─────────────────────────────────────────────
    # httpx 클라이언트 팩토리
    # ─────────────────────────────────────────────

    def _make_client(
        self, timeout: float = _GENERATION_TIMEOUT
    ) -> httpx.AsyncClient:
        """타임아웃이 설정된 httpx.AsyncClient 생성"""
        return httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(timeout, connect=_HEALTH_TIMEOUT),
        )

    # ─────────────────────────────────────────────
    # 이미지 업로드 (ComfyUI input 디렉토리)
    # ─────────────────────────────────────────────

    async def upload_image(self, image_path: str, filename: str) -> str:
        """
        이미지를 ComfyUI input 디렉토리로 업로드
        POST /upload/image (multipart form data)
        반환: ComfyUI가 실제 저장한 파일명
        """
        try:
            async with self._make_client() as client:
                with open(image_path, "rb") as f:
                    files = {
                        "image": (filename, f, "image/png"),
                    }
                    data = {
                        "overwrite": "true",
                    }
                    resp = await client.post(
                        "/upload/image",
                        files=files,
                        data=data,
                    )
                    resp.raise_for_status()
                    result = resp.json()
                    uploaded_name = result.get("name", filename)
                    logger.info(
                        "ComfyUI 이미지 업로드 완료: %s → %s",
                        filename,
                        uploaded_name,
                    )
                    return uploaded_name
        except httpx.TimeoutException as exc:
            logger.error("이미지 업로드 타임아웃: %s", exc)
            raise
        except httpx.HTTPStatusError as exc:
            logger.error(
                "이미지 업로드 HTTP 오류 %d: %s",
                exc.response.status_code,
                exc.response.text,
            )
            raise
        except httpx.HTTPError as exc:
            logger.error("이미지 업로드 실패: %s", exc)
            raise

    # ─────────────────────────────────────────────
    # 프롬프트 큐잉
    # ─────────────────────────────────────────────

    async def queue_prompt(
        self, workflow_json: dict, client_id: str
    ) -> dict[str, Any]:
        """
        ComfyUI에 워크플로우 전송 (POST /prompt)
        반환: {"prompt_id": "xxx", ...}
        """
        payload = {
            "prompt": workflow_json,
            "client_id": client_id,
        }

        try:
            async with self._make_client() as client:
                resp = await client.post("/prompt", json=payload)
                resp.raise_for_status()
                data = resp.json()
                logger.info("프롬프트 큐 등록 완료: %s", data.get("prompt_id"))
                return data
        except httpx.TimeoutException as exc:
            logger.error("프롬프트 큐잉 타임아웃: %s", exc)
            raise
        except httpx.HTTPStatusError as exc:
            logger.error(
                "프롬프트 큐잉 HTTP 오류 %d: %s",
                exc.response.status_code,
                exc.response.text,
            )
            raise
        except httpx.HTTPError as exc:
            logger.error("프롬프트 큐잉 실패: %s", exc)
            raise

    # ─────────────────────────────────────────────
    # 히스토리 조회
    # ─────────────────────────────────────────────

    async def get_history(self, prompt_id: str) -> dict[str, Any]:
        """
        생성 히스토리 조회 (GET /history/{prompt_id})
        반환: 프롬프트 실행 결과 (출력 이미지 정보 포함)
        """
        try:
            async with self._make_client(timeout=_HEALTH_TIMEOUT) as client:
                resp = await client.get(f"/history/{prompt_id}")
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as exc:
            logger.error("히스토리 조회 실패 (prompt_id=%s): %s", prompt_id, exc)
            raise

    # ─────────────────────────────────────────────
    # 이미지 다운로드
    # ─────────────────────────────────────────────

    async def get_image(
        self, filename: str, subfolder: str = "", type_: str = "output"
    ) -> bytes:
        """
        ComfyUI에서 이미지 바이너리 다운로드 (GET /view)
        매개변수:
            filename: 이미지 파일명
            subfolder: 하위 폴더 (빈 문자열이면 루트)
            type_: 이미지 타입 (output, input, temp)
        """
        params = {
            "filename": filename,
            "subfolder": subfolder,
            "type": type_,
        }

        try:
            async with self._make_client() as client:
                resp = await client.get("/view", params=params)
                resp.raise_for_status()
                return resp.content
        except httpx.HTTPError as exc:
            logger.error("이미지 다운로드 실패 (%s): %s", filename, exc)
            raise

    # ─────────────────────────────────────────────
    # 생성 중단
    # ─────────────────────────────────────────────

    async def interrupt(self) -> bool:
        """현재 생성 작업 중단 (POST /interrupt)"""
        try:
            async with self._make_client(timeout=_HEALTH_TIMEOUT) as client:
                resp = await client.post("/interrupt")
                resp.raise_for_status()
                logger.info("생성 작업 중단 요청 완료")
                return True
        except httpx.HTTPError as exc:
            logger.error("생성 중단 요청 실패: %s", exc)
            return False

    # ─────────────────────────────────────────────
    # 모델 목록 조회
    # ─────────────────────────────────────────────

    async def get_models(self) -> dict[str, list[str]]:
        """
        사용 가능한 모델 목록 조회 (GET /object_info)
        반환: {"checkpoints": [...], "loras": [...], "vaes": [...], "diffusion_models": [...]}
        """
        result: dict[str, list[str]] = {
            "checkpoints": [],
            "loras": [],
            "vaes": [],
            "diffusion_models": [],
        }

        try:
            async with self._make_client(timeout=30.0) as client:
                resp = await client.get("/object_info")
                resp.raise_for_status()
                object_info = resp.json()

            # CheckpointLoaderSimple → ckpt_name 입력의 선택지
            ckpt_info = object_info.get("CheckpointLoaderSimple", {})
            ckpt_input = ckpt_info.get("input", {}).get("required", {})
            if "ckpt_name" in ckpt_input:
                result["checkpoints"] = list(ckpt_input["ckpt_name"][0])

            # UNETLoader → unet_name 입력의 선택지 (Qwen, Flux 등 최신 모델)
            unet_info = object_info.get("UNETLoader", {})
            unet_input = unet_info.get("input", {}).get("required", {})
            if "unet_name" in unet_input:
                result["diffusion_models"] = list(unet_input["unet_name"][0])

            # LoraLoader → lora_name 입력의 선택지
            lora_info = object_info.get("LoraLoader", {})
            lora_input = lora_info.get("input", {}).get("required", {})
            if "lora_name" in lora_input:
                result["loras"] = list(lora_input["lora_name"][0])

            # VAELoader → vae_name 입력의 선택지
            vae_info = object_info.get("VAELoader", {})
            vae_input = vae_info.get("input", {}).get("required", {})
            if "vae_name" in vae_input:
                result["vaes"] = list(vae_input["vae_name"][0])

            logger.info(
                "모델 목록 조회: 체크포인트=%d, UNET=%d, LoRA=%d, VAE=%d",
                len(result["checkpoints"]),
                len(result["diffusion_models"]),
                len(result["loras"]),
                len(result["vaes"]),
            )

        except httpx.HTTPError as exc:
            logger.error("모델 목록 조회 실패: %s", exc)
            raise

        return result

    # ─────────────────────────────────────────────
    # WebSocket 실시간 진행 상황
    # ─────────────────────────────────────────────

    async def connect_ws(
        self, client_id: str
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        ComfyUI WebSocket 연결 — 생성 진행 메시지 스트리밍
        전달되는 메시지 타입:
            - execution_start: 실행 시작
            - executing: 노드 실행 중 (node=None이면 완료)
            - progress: 단계별 진행률 (value, max)
            - executed: 노드 실행 완료 (출력 포함)
            - execution_error: 실행 오류
        """
        ws_uri = f"{self._ws_url}/ws?clientId={client_id}"
        logger.info("ComfyUI WebSocket 연결: %s", ws_uri)

        try:
            async with websockets.connect(
                ws_uri,
                open_timeout=_WS_CONNECT_TIMEOUT,
                close_timeout=_HEALTH_TIMEOUT,
                ping_interval=30,   # 30초마다 ping으로 연결 상태 확인
                ping_timeout=10,    # 10초 내 pong 없으면 끊김 감지
            ) as ws:
                async for raw_message in ws:
                    # 바이너리 메시지는 프리뷰 이미지 — 스킵
                    if isinstance(raw_message, bytes):
                        continue

                    try:
                        message = json.loads(raw_message)
                    except json.JSONDecodeError:
                        logger.warning("WebSocket JSON 파싱 실패: %s", raw_message[:100])
                        continue

                    msg_type = message.get("type", "")
                    msg_data = message.get("data", {})

                    logger.debug("WS 메시지: type=%s", msg_type)
                    yield {"type": msg_type, "data": msg_data}

                    # executing 메시지에서 node=None이면 실행 완료
                    if msg_type == "executing" and msg_data.get("node") is None:
                        logger.info("ComfyUI 실행 완료 (prompt_id=%s)", msg_data.get("prompt_id"))
                        return

                    # 실행 오류 시 종료
                    if msg_type == "execution_error":
                        logger.error("ComfyUI 실행 오류: %s", msg_data)
                        return

        except websockets.exceptions.ConnectionClosedError as exc:
            # 조기 종료를 호출부가 감지할 수 있도록 명시적 에러 이벤트 yield
            # (기존: 경고만 남기고 조용히 종료 → 잘못된 완료 흐름 가능성)
            logger.warning("WebSocket 연결 종료: %s", exc)
            yield {
                "type": "connection_closed",
                "data": {"message": f"ComfyUI WebSocket 연결이 종료되었습니다: {exc}"},
            }
        except websockets.exceptions.WebSocketException as exc:
            logger.error("WebSocket 오류: %s", exc)
            raise
        except TimeoutError:
            logger.error("WebSocket 연결 타임아웃")
            raise

    # ─────────────────────────────────────────────
    # 이미지 저장 (로컬 디스크)
    # ─────────────────────────────────────────────

    async def save_image(
        self,
        image_data: bytes,
        filename: str,
        date_subfolder: bool = True,
    ) -> Path:
        """
        이미지를 로컬 output 디렉토리에 저장
        - 날짜별 하위 폴더 생성 (YYYY-MM-DD/)
        반환: 저장된 파일의 절대 경로
        """
        base_dir = Path(settings.output_image_path)

        if date_subfolder:
            today = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
            save_dir = base_dir / today
        else:
            save_dir = base_dir

        save_dir.mkdir(parents=True, exist_ok=True)

        # path traversal 방지: 파일명에서 디렉토리 구분자 제거
        safe_filename = Path(filename).name
        if not safe_filename:
            safe_filename = f"image_{int(datetime.now(tz=timezone.utc).timestamp())}.png"

        file_path = save_dir / safe_filename

        # 동일 파일명 존재 시 넘버링
        counter = 1
        original_stem = file_path.stem
        suffix = file_path.suffix
        while file_path.exists():
            file_path = save_dir / f"{original_stem}_{counter}{suffix}"
            counter += 1

        file_path.write_bytes(image_data)
        logger.info("이미지 저장 완료: %s (%d bytes)", file_path, len(image_data))

        return file_path

    # ─────────────────────────────────────────────
    # 히스토리에서 이미지 일괄 다운로드 + 저장
    # ─────────────────────────────────────────────

    async def download_and_save_images(
        self, prompt_id: str
    ) -> list[dict[str, Any]]:
        """
        프롬프트 히스토리에서 생성된 이미지를 모두 다운로드하여 저장
        반환: 프론트엔드 호환 이미지 정보 목록
              [{ "url": "/images/2026-04-11/file.png",
                 "filename": "file.png",
                 "seed": 12345 }]
        """
        history = await self.get_history(prompt_id)

        # 히스토리에서 해당 프롬프트 결과 추출
        prompt_history = history.get(prompt_id, {})
        outputs = prompt_history.get("outputs", {})

        # KSampler 노드에서 seed 추출 시도
        # ComfyUI 히스토리의 prompt 필드는 리스트:
        # [index, prompt_id, workflow_dict, extra_data, output_nodes]
        raw_prompt = prompt_history.get("prompt", {})
        if isinstance(raw_prompt, list) and len(raw_prompt) > 2:
            prompt_inputs = raw_prompt[2] if isinstance(raw_prompt[2], dict) else {}
        elif isinstance(raw_prompt, dict):
            prompt_inputs = raw_prompt
        else:
            prompt_inputs = {}
        seed = self._extract_seed_from_prompt(prompt_inputs)

        saved_images: list[dict[str, Any]] = []
        base_dir = Path(settings.output_image_path)

        for _node_id, node_output in outputs.items():
            images = node_output.get("images", [])
            for img_info in images:
                filename = img_info.get("filename", "")
                subfolder = img_info.get("subfolder", "")
                img_type = img_info.get("type", "output")

                if not filename:
                    continue

                try:
                    image_data = await self.get_image(
                        filename=filename,
                        subfolder=subfolder,
                        type_=img_type,
                    )
                    saved_path = await self.save_image(image_data, filename)

                    # 절대경로 → 상대 URL로 변환 (/images/YYYY-MM-DD/file.png)
                    relative = saved_path.relative_to(base_dir)
                    url = f"/images/{relative.as_posix()}"

                    saved_images.append({
                        "url": url,
                        "filename": saved_path.name,
                        "seed": seed,
                    })
                except httpx.HTTPError as exc:
                    logger.error(
                        "이미지 다운로드/저장 실패 (%s): %s", filename, exc
                    )

        logger.info(
            "프롬프트 %s: %d개 이미지 저장 완료", prompt_id, len(saved_images)
        )
        return saved_images

    @staticmethod
    def _extract_seed_from_prompt(
        prompt_data: dict[str, Any],
    ) -> int:
        """ComfyUI 프롬프트 데이터에서 KSampler의 seed 값 추출"""
        for _node_id, node in prompt_data.items():
            if not isinstance(node, dict):
                continue
            if node.get("class_type") == "KSampler":
                inputs = node.get("inputs", {})
                return int(inputs.get("seed", -1))
        return -1


# 싱글톤 인스턴스
comfyui_client = ComfyUIClient()
