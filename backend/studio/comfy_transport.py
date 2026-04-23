"""
comfy_transport.py - ComfyUI 실 디스패치 (HTTP + WebSocket).

책임:
- submit(api_prompt, client_id) → POST /prompt → prompt_id
- listen(client_id, prompt_id) → WebSocket 로 진행 이벤트 async-generator yield
- get_history(prompt_id) → 결과 이미지 파일 목록
- download_image(filename, subfolder, type) → bytes

Legacy backend/services/comfyui_client.py 의 WebSocket 패턴 참고.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator

import httpx
import websockets
import websockets.exceptions

from config import settings

log = logging.getLogger(__name__)

# settings 가 import 실패 시에만 쓰이는 폴백 (정상 실행 경로에선 settings.comfyui_url 사용)
_FALLBACK_COMFY_URL = "http://127.0.0.1:8000"
HTTP_TIMEOUT = 30.0


@dataclass
class ComfyProgress:
    """WebSocket 이벤트 구조화."""

    kind: str
    """'progress' | 'executing' | 'executed' | 'status' | 'execution_start' | 'execution_cached' | 'execution_success' | 'execution_error'"""

    data: dict[str, Any]

    @property
    def percent(self) -> float | None:
        """progress 이벤트에서 0.0~1.0 범위로 진행률 계산."""
        if self.kind == "progress":
            value = self.data.get("value")
            mx = self.data.get("max")
            if value is not None and mx:
                return float(value) / float(mx)
        return None


class ComfyUITransport:
    """ComfyUI 서버와 통신하는 단일 추상화.

    Usage:
        async with ComfyUITransport() as comfy:
            prompt_id = await comfy.submit(api_prompt, client_id)
            async for evt in comfy.listen(client_id, prompt_id):
                ...
            history = await comfy.get_history(prompt_id)
    """

    def __init__(self, base_url: str | None = None) -> None:
        # 기본값은 settings.comfyui_url (env/.env 반영). 명시 주입이 최우선.
        resolved = base_url or settings.comfyui_url or _FALLBACK_COMFY_URL
        self.base_url = resolved.rstrip("/")
        self._http: httpx.AsyncClient | None = None

    async def __aenter__(self) -> ComfyUITransport:
        self._http = httpx.AsyncClient(
            base_url=self.base_url, timeout=HTTP_TIMEOUT
        )
        return self

    async def __aexit__(self, *exc) -> None:
        if self._http:
            await self._http.aclose()
            self._http = None

    # ─────────── HTTP ───────────

    async def submit(self, api_prompt: dict[str, Any], client_id: str) -> str:
        """POST /prompt → prompt_id.

        Raises:
            RuntimeError: ComfyUI 가 validation 실패 반환 시.
        """
        assert self._http, "Use `async with` context"
        payload = {"prompt": api_prompt, "client_id": client_id}
        resp = await self._http.post("/prompt", json=payload)
        if resp.status_code >= 400:
            detail = resp.text[:500]
            raise RuntimeError(
                f"ComfyUI /prompt {resp.status_code}: {detail}"
            )
        data = resp.json()
        prompt_id = data.get("prompt_id")
        if not prompt_id:
            raise RuntimeError(f"ComfyUI response missing prompt_id: {data}")
        return prompt_id

    async def get_history(self, prompt_id: str) -> dict[str, Any]:
        assert self._http, "Use `async with` context"
        resp = await self._http.get(f"/history/{prompt_id}")
        resp.raise_for_status()
        data = resp.json()
        return data.get(prompt_id, {})

    async def download_image(
        self,
        filename: str,
        subfolder: str = "",
        image_type: str = "output",
    ) -> bytes:
        """GET /view → 이미지 바이트."""
        assert self._http, "Use `async with` context"
        params = {
            "filename": filename,
            "subfolder": subfolder,
            "type": image_type,
        }
        resp = await self._http.get("/view", params=params)
        resp.raise_for_status()
        return resp.content

    async def upload_image(
        self,
        image_bytes: bytes,
        filename: str,
        subfolder: str = "",
    ) -> str:
        """POST /upload/image — ComfyUI 의 input/ 폴더에 저장. 저장된 파일명 반환."""
        assert self._http, "Use `async with` context"
        files = {"image": (filename, image_bytes, "image/png")}
        data = {"type": "input", "subfolder": subfolder, "overwrite": "true"}
        resp = await self._http.post("/upload/image", files=files, data=data)
        resp.raise_for_status()
        result = resp.json()
        return result.get("name", filename)

    async def interrupt(self) -> None:
        """POST /interrupt — 현재 실행 중인 prompt 취소."""
        assert self._http, "Use `async with` context"
        try:
            await self._http.post("/interrupt")
        except Exception as e:
            log.warning("ComfyUI interrupt failed: %s", e)

    # ─────────── WebSocket ───────────

    async def listen(
        self,
        client_id: str,
        prompt_id: str,
        *,
        idle_timeout: float = 600.0,
        hard_timeout: float = 1800.0,
    ) -> AsyncIterator[ComfyProgress]:
        """prompt_id 의 완료까지 WebSocket 이벤트 스트림.

        - idle_timeout: 아무 메시지도 안 오는 상태가 이만큼 지속되면 timeout (기본 10분)
          → 모델 로드 중엔 메시지가 주기적으로 와서 리셋됨. 실제 "멈춤" 만 잡음.
        - hard_timeout: 총 상한 (기본 30분). 안전망.

        종료 조건:
        - `execution_success` / `execution_error` 이벤트 수신
        - idle 또는 hard timeout
        """
        ws_url = (
            self.base_url.replace("http://", "ws://").replace(
                "https://", "wss://"
            )
            + f"/ws?clientId={client_id}"
        )
        try:
            async with websockets.connect(
                ws_url,
                ping_interval=20.0,
                ping_timeout=10.0,
                close_timeout=5.0,
            ) as ws:
                start = asyncio.get_event_loop().time()
                last_msg_at = start
                while True:
                    now = asyncio.get_event_loop().time()
                    if now - start > hard_timeout:
                        raise TimeoutError(
                            f"ComfyUI WS hard timeout ({hard_timeout:.0f}s)"
                        )

                    # 남은 idle 예산만큼 wait_for 로 recv 대기 → 초과 시 idle timeout
                    remaining = idle_timeout - (now - last_msg_at)
                    if remaining <= 0:
                        raise TimeoutError(
                            f"ComfyUI WS idle timeout ({idle_timeout:.0f}s · 메시지 무응답)"
                        )
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=remaining)
                    except asyncio.TimeoutError as e:
                        raise TimeoutError(
                            f"ComfyUI WS idle timeout ({idle_timeout:.0f}s · 메시지 무응답)"
                        ) from e

                    last_msg_at = asyncio.get_event_loop().time()
                    if isinstance(msg, bytes):
                        # 바이너리 프리뷰 프레임 — 스킵 (지금은 프리뷰 안 씀)
                        continue
                    try:
                        parsed = json.loads(msg)
                    except json.JSONDecodeError:
                        continue

                    kind = parsed.get("type", "")
                    data = parsed.get("data") or {}
                    # prompt_id 무관한 전역 이벤트도 받을 수 있음 — 우리 것만 필터
                    this_prompt = data.get("prompt_id")
                    if this_prompt and this_prompt != prompt_id:
                        continue

                    yield ComfyProgress(kind=kind, data=data)

                    if kind == "execution_success":
                        return
                    if kind == "execution_error":
                        return
        except websockets.exceptions.ConnectionClosedError as e:
            raise RuntimeError(f"ComfyUI WS closed unexpectedly: {e}") from e


def extract_output_images(history_entry: dict[str, Any]) -> list[dict[str, str]]:
    """history 응답에서 SaveImage 노드의 출력 파일 추출.

    Returns:
        [{filename, subfolder, type}, ...]
    """
    outputs = history_entry.get("outputs", {})
    results: list[dict[str, str]] = []
    for _node_id, node_output in outputs.items():
        images = node_output.get("images", []) if isinstance(node_output, dict) else []
        for img in images:
            results.append(
                {
                    "filename": img.get("filename", ""),
                    "subfolder": img.get("subfolder", ""),
                    "type": img.get("type", "output"),
                }
            )
    return results
