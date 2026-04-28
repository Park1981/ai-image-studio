"""POST /api/studio/edit 의 multi-reference 토글 게이트 테스트 (Phase 1 · 2026-04-27).

Codex 2차 리뷰 fix #4: useReferenceImage=true 인데 reference_image 파일 없는 케이스 거부.
Codex 리뷰 (zero-regression): useReferenceImage=false 면 reference_role 도 강제 None 처리
(role 누수로 SYSTEM_EDIT 에 multi-ref clause 가 들어가는 위험 차단).
"""

from __future__ import annotations

import io
import json

import pytest
from PIL import Image


def _png_bytes(w: int = 64, h: int = 64) -> bytes:
    """유효한 PNG bytes 생성 (test_edit_upload_validation.py 와 동일 패턴)."""
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=(120, 130, 140)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_edit_endpoint_rejects_useref_true_without_file() -> None:
    """useReferenceImage=true 인데 reference_image 파일 미동봉 → 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    # 정상 source 이미지만 동봉, reference_image 없음
    src_bytes = _png_bytes()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={"image": ("src.png", io.BytesIO(src_bytes), "image/png")},
            data={
                "meta": json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": True,  # ← 토글 ON
                        "referenceRole": "face",
                        # reference_image 파일 안 보냄
                    }
                ),
            },
        )
    assert response.status_code == 400, response.text
    assert "참조 이미지" in response.json().get("detail", "")


@pytest.mark.asyncio
async def test_edit_endpoint_rejects_useref_true_with_empty_file() -> None:
    """useReferenceImage=true 인데 reference_image 가 0바이트 파일 → 400."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    src_bytes = _png_bytes()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", io.BytesIO(src_bytes), "image/png"),
                "reference_image": ("ref.png", io.BytesIO(b""), "image/png"),  # 빈 파일
            },
            data={
                "meta": json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": True,
                        "referenceRole": "face",
                    }
                ),
            },
        )
    assert response.status_code == 400, response.text


@pytest.mark.asyncio
async def test_edit_endpoint_drains_reference_when_useref_false(monkeypatch) -> None:
    """useRef=false + reference_image 동봉 → 200, 파일 drain 후 무시 (silent drop 회귀 방지).

    Codex Phase 1-3 통합 리뷰 Important #1: 클라이언트가 토글 OFF 인데
    multipart 에 reference_image 를 같이 보내면 옛 코드는 silent drop. 신규
    코드는 명시적 drain + log warning. 파이프라인엔 reference_bytes None 전달.
    """
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    captured_kwargs: dict = {}

    def _fake_run_edit(*args, **kwargs):
        captured_kwargs.update(kwargs)

        async def _noop():
            return None

        return _noop()

    monkeypatch.setattr("studio.routes.streams._run_edit_pipeline", _fake_run_edit)

    src_bytes = _png_bytes()
    ref_bytes = _png_bytes(32, 32)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", io.BytesIO(src_bytes), "image/png"),
                # reference_image 동봉했지만 토글 OFF — 무시되어야 함
                "reference_image": ("ref.png", io.BytesIO(ref_bytes), "image/png"),
            },
            data={
                "meta": json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": False,  # OFF — 파일 무시
                    }
                ),
            },
        )
    # task 생성 성공 (200) — 파일은 drain 후 무시
    assert response.status_code == 200, response.text
    assert captured_kwargs.get("reference_bytes") is None
    assert captured_kwargs.get("reference_filename") is None
    assert captured_kwargs.get("reference_role") is None


@pytest.mark.asyncio
async def test_edit_endpoint_role_ignored_when_useref_false(monkeypatch) -> None:
    """useReferenceImage=false 면 referenceRole 도 게이트로 None 강제 (누수 방지)."""
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    # _run_edit_pipeline 호출 캡처해서 reference_role 검증.
    captured_kwargs: dict = {}

    def _fake_run_edit(*args, **kwargs):
        # Codex 3차 리뷰 fix: async body 에서 캡처하면 background task 실행 타이밍에
        # 의존하므로, sync wrapper 가 호출 즉시 kwargs 를 저장하고 noop coroutine 반환.
        captured_kwargs.update(kwargs)

        async def _noop():
            return None

        return _noop()

    # mock.patch 위치 = lookup 모듈 기준 (CLAUDE.md 🔴 Critical 규칙).
    # routes.streams 안의 _run_edit_pipeline 을 가로챔.
    monkeypatch.setattr("studio.routes.streams._run_edit_pipeline", _fake_run_edit)

    src_bytes = _png_bytes()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={"image": ("src.png", io.BytesIO(src_bytes), "image/png")},
            data={
                "meta": json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": False,  # OFF
                        "referenceRole": "face",  # 누수 시도
                    }
                ),
            },
        )
    # task 생성은 성공 (200) — 하지만 role 은 게이트로 None 강제
    assert response.status_code == 200, response.text
    assert captured_kwargs.get("reference_role") is None
    assert captured_kwargs.get("reference_bytes") is None


# ─────────────────────────────────────────────
# Phase 1 회귀 베이스라인 — build_edit_api 단위 테스트
# reference_image_filename=None 일 때 옛 코드 path 와 100% 동일 검증.
# ─────────────────────────────────────────────


def _make_edit_input(
    reference_filename: str | None = None,
    reference_role: str | None = None,
):
    """EditApiInput 헬퍼 — 기본값으로 채우고 reference 만 override."""
    from studio.comfy_api_builder import EditApiInput
    from studio.presets import EDIT_MODEL

    d = EDIT_MODEL.defaults
    return EditApiInput(
        prompt="test prompt",
        source_image_filename="src.png",
        seed=42,
        steps=d.steps,
        cfg=d.cfg,
        sampler=d.sampler,
        scheduler=d.scheduler,
        shift=d.shift,
        lightning=False,
        unet_name=EDIT_MODEL.files.unet,
        clip_name=EDIT_MODEL.files.clip,
        vae_name=EDIT_MODEL.files.vae,
        extra_loras=[],
        lightning_lora_name=None,
        reference_image_filename=reference_filename,
        reference_role=reference_role,
    )


def test_no_reference_returns_single_path():
    """reference_image_filename=None 이면 옛 path 의 핵심 노드 모두 존재 + LoadImage 1개."""
    from studio.comfy_api_builder import build_edit_api

    inp = _make_edit_input(reference_filename=None)
    api = build_edit_api(inp)

    # 옛 path 의 핵심 노드 존재 확인
    classes = {node["class_type"] for node in api.values()}
    assert "LoadImage" in classes
    assert "FluxKontextImageScale" in classes
    assert "TextEncodeQwenImageEditPlus" in classes
    assert "VAEEncode" in classes
    assert "KSampler" in classes
    assert "SaveImage" in classes

    # 단일 이미지 path 라 LoadImage 가 정확히 1개여야 함
    load_count = sum(1 for n in api.values() if n["class_type"] == "LoadImage")
    assert load_count == 1


def test_reference_filename_with_stub_returns_same_as_single():
    """Phase 1: _build_edit_api_multi_ref 가 stub 폴백 → 단일 path 와 동일.

    Phase 4 에서 진짜 multi-ref 노드 체인 작성 시 이 테스트는 갱신.
    """
    from studio.comfy_api_builder import build_edit_api

    inp_single = _make_edit_input(reference_filename=None)
    inp_multi = _make_edit_input(reference_filename="ref.png", reference_role="face")

    api_single = build_edit_api(inp_single)
    api_multi = build_edit_api(inp_multi)

    # Phase 1 stub: multi-ref 도 단일 path 와 동일한 키 셋
    assert set(api_single.keys()) == set(api_multi.keys())
