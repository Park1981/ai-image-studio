"""Capture ComfyUI /object_info for Plan A Phase 1.5 validation."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
OUTPUT_PATH = Path(__file__).resolve().parent / "_capture_object_info.json"


async def capture(comfy_url: str) -> dict:
    """GET ComfyUI /object_info and return the JSON response."""

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{comfy_url.rstrip('/')}/object_info")
        resp.raise_for_status()
        return resp.json()


async def main() -> int:
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))

    from config import settings

    comfy_url = settings.comfyui_url or "http://127.0.0.1:8000"
    print(f"ComfyUI URL: {comfy_url}")

    try:
        info = await capture(comfy_url)
    except httpx.HTTPError as exc:
        print(f"ComfyUI 호출 실패: {exc}", file=sys.stderr)
        print("ComfyUI 가 동작 중인지 확인해 주세요.", file=sys.stderr)
        return 1

    OUTPUT_PATH.write_text(
        json.dumps(info, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"{len(info)} 개 노드 캡처 -> {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
