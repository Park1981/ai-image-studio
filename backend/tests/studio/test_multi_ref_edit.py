"""POST /api/studio/edit 의 multi-reference 토글 게이트 테스트 (Phase 1 · 2026-04-27).

Codex 2차 리뷰 fix #4: useReferenceImage=true 인데 reference_image 파일 없는 케이스 거부.
Codex 리뷰 (zero-regression): useReferenceImage=false 면 reference_role 도 강제 None 처리
(role 누수로 SYSTEM_EDIT 에 multi-ref clause 가 들어가는 위험 차단).
"""

from __future__ import annotations

import io
import json
from types import SimpleNamespace

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
async def test_edit_endpoint_accepts_small_cropped_reference(monkeypatch) -> None:
    """cropped reference (Phase 2 · 2026-04-28 클라이언트 수동 crop 산물) 통과 회귀.

    Phase 2 에서 클라이언트가 보내는 reference_image 는 원본이 아니라
    canvas 로 잘린 작은 PNG (`reference-crop.png` · 예: 256x256).
    백엔드는 사이즈/파일명에 의존하지 않고 multipart 그대로 수용해야 함.

    검증:
      - 작은 cropped PNG (256x256) + 파일명 "reference-crop.png" → 200
      - _run_edit_pipeline 호출 시 reference_bytes 가 cropped 길이 그대로
      - reference_filename 이 클라이언트 파일명 보존
      - reference_role 정확히 전달 ("face")
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
    # Phase 2 의 cropped 산물을 흉내 — 작은 사이즈 + 파일명 명시
    cropped_bytes = _png_bytes(256, 256)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", io.BytesIO(src_bytes), "image/png"),
                "reference_image": (
                    "reference-crop.png",
                    io.BytesIO(cropped_bytes),
                    "image/png",
                ),
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

    assert response.status_code == 200, response.text
    # cropped bytes 가 그대로 파이프라인에 전달 (변형 없음)
    assert captured_kwargs.get("reference_bytes") == cropped_bytes
    assert len(captured_kwargs["reference_bytes"]) == len(cropped_bytes)
    # 파일명 보존 — 클라이언트가 보낸 reference-crop.png 그대로
    assert captured_kwargs.get("reference_filename") == "reference-crop.png"
    # role 정확 전달
    assert captured_kwargs.get("reference_role") == "face"


@pytest.mark.asyncio
async def test_edit_endpoint_accepts_tiny_cropped_reference(monkeypatch) -> None:
    """클라이언트 256px 가드를 우회한 더 작은 reference 도 백엔드는 거부 안 함 (회귀).

    클라이언트의 256px 최소 가드는 UX 차원 — 백엔드는 사이즈 검증 안 함.
    이 분리가 유지되는지 회귀 (백엔드에 사이즈 검증을 *추가하지 말 것* 신호).
    """
    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    def _fake_run_edit(*args, **kwargs):
        async def _noop():
            return None

        return _noop()

    monkeypatch.setattr("studio.routes.streams._run_edit_pipeline", _fake_run_edit)

    src_bytes = _png_bytes()
    tiny_bytes = _png_bytes(64, 64)  # 클라이언트 가드(256) 보다 훨씬 작음

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", io.BytesIO(src_bytes), "image/png"),
                "reference_image": (
                    "reference-crop.png",
                    io.BytesIO(tiny_bytes),
                    "image/png",
                ),
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

    # 백엔드는 사이즈에 무관 — 클라이언트 정책 사항
    assert response.status_code == 200, response.text


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


# ─────────────────────────────────────────────
# Phase 4 Task 12: build_reference_clause 단위 테스트
# SYSTEM_EDIT 의 role 별 동적 clause 빌드 검증.
# ─────────────────────────────────────────────


def test_build_reference_clause_none_returns_empty():
    """None 또는 빈 문자열 → 옛 흐름 (빈 문자열 — SYSTEM_EDIT 변화 0)."""
    from studio.prompt_pipeline import build_reference_clause

    assert build_reference_clause(None) == ""
    assert build_reference_clause("") == ""


def test_build_reference_clause_face_preset():
    """face preset → ROLE_INSTRUCTIONS 의 정의된 instruction 주입."""
    from studio.prompt_pipeline import build_reference_clause

    out = build_reference_clause("face")
    assert "MULTI-REFERENCE MODE" in out
    assert "STRICT FACE-ONLY TRANSFER" in out
    assert "FROM IMAGE2: copy ONLY the face identity" in out
    assert "FROM IMAGE1: preserve hair length" in out
    assert "Do NOT use image2 for hair" in out


def test_build_reference_clause_includes_output_naming_convention():
    """모든 role 의 prefix 가 OUTPUT NAMING CONVENTION directive 를 포함 (2026-04-28).

    gemma4 output 표현 강제 — 'the source image', 'the original' 등의 풀어쓰기
    대신 image1/image2 만 사용. 이전엔 정의만 있고 output convention 이 없어
    gemma4 가 image2 는 명시하면서 image1 자리는 풀어쓰는 비대칭 결과가
    났던 회귀 (사용자 검증 케이스 · `Replace ... in the source image` ...).
    """
    from studio.prompt_pipeline import build_reference_clause

    for role in ("face", "outfit", "style", "background", "헤어스타일 참조"):
        out = build_reference_clause(role)
        # 정의는 그대로 살아있고
        assert "MULTI-REFERENCE MODE" in out, role
        # output convention directive 도 항상 포함
        assert "OUTPUT NAMING CONVENTION" in out, role
        assert "Only 'image1' and 'image2' are allowed" in out, role
        # 사용자 의도와 어긋나는 풀어쓰기 표현이 *금지 목록* 으로 명시됨
        assert "'the source image'" in out, role
        assert "'the original'" in out, role


def test_build_reference_clause_custom_text():
    """preset 외 자유 텍스트 → User-described role 로 그대로 주입 (한글도 OK)."""
    from studio.prompt_pipeline import build_reference_clause

    out = build_reference_clause("헤어스타일 참조")
    assert "MULTI-REFERENCE MODE" in out
    assert "헤어스타일 참조" in out


def test_build_reference_clause_truncates_long_text():
    """200자 cap 검증 — 악성 긴 토큰 주입 방지."""
    from studio.prompt_pipeline import build_reference_clause

    long_text = "x" * 500
    out = build_reference_clause(long_text)
    # 200자 cap 검증 — 결과 안에 200개의 x 포함되되, 500개는 안 됨
    assert "x" * 200 in out
    assert "x" * 201 not in out


def test_face_reference_overrides_source_face_matrix_preserve():
    """face role 에서 matrix 의 face preserve 가 [reference_from_image2] 명시 액션으로 *교체*.

    2026-04-28 메커니즘 진화:
      - 옛 동작 (Phase 0): face role 시 face_expression 이 [reference] 커스텀 phrasing 으로 변환
      - Phase 1 (Slot Removal): face_expression 슬롯이 directive 에서 *제거* — 침묵 전략
        → 사용자 검증 결과 LLM 이 default-preserve 로 환각 (실패)
      - Phase 1' (Slot Replacement · codex 리뷰 반영): face_expression 슬롯이
        [reference_from_image2] 명시 액션으로 *교체* — 매트릭스 안에 경쟁 권위 박힘

    테스트 의도: face role 에서 image1 의 face preserve 지시가 매트릭스에 박히지 않고,
    image2 face identity 적용 지시가 *명시적으로* 박혀야 함.
    """
    from studio.prompt_pipeline import _build_matrix_directive_block

    analysis = SimpleNamespace(
        fallback=False,
        domain="person",
        intent="Change the outfit to a swimsuit.",
        slots={
            "face_expression": SimpleNamespace(
                action="preserve",
                note="original face",
            ),
            "hair": SimpleNamespace(action="preserve", note="original hair"),
        },
    )

    out = _build_matrix_directive_block(analysis, reference_role="face")

    # face_expression 슬롯이 [reference_from_image2] 명시 액션으로 교체
    assert "[reference] face / expression" not in out  # 옛 커스텀 phrasing 부재
    assert "[preserve] face / expression" not in out  # preserve 사라짐
    assert "[reference_from_image2] face / expression" in out  # 새 명시 액션
    assert "Apply image2's face / expression" in out
    # 다른 슬롯 (hair) 은 그대로 보존
    assert "[preserve] hair" in out


def test_reference_returns_extra_load_image_node():
    """Phase 4 Task 15: multi-ref 케이스는 LoadImage 노드 2개 (image1 + image2).

    옛 stub 테스트를 진짜 검증으로 교체 (Codex Phase 1-3 통합 리뷰 Important #2 fix).
    """
    from studio.comfy_api_builder import build_edit_api

    inp_single = _make_edit_input(reference_filename=None)
    inp_multi = _make_edit_input(reference_filename="ref.png", reference_role="face")

    api_single = build_edit_api(inp_single)
    api_multi = build_edit_api(inp_multi)

    # Single path: LoadImage 1개 (옛 흐름)
    load_count_single = sum(
        1 for n in api_single.values() if n["class_type"] == "LoadImage"
    )
    assert load_count_single == 1

    # Multi-ref: LoadImage 2개 (image1 + image2)
    load_count_multi = sum(
        1 for n in api_multi.values() if n["class_type"] == "LoadImage"
    )
    assert load_count_multi == 2

    # FluxKontextImageScale 도 2개 (각 image 별)
    scale_count_multi = sum(
        1 for n in api_multi.values() if n["class_type"] == "FluxKontextImageScale"
    )
    assert scale_count_multi == 2

    # TextEncodeQwenImageEditPlus pos + neg 둘 다 image2 슬롯에도 연결됐는지
    encode_nodes = [
        n for n in api_multi.values()
        if n["class_type"] == "TextEncodeQwenImageEditPlus"
    ]
    assert len(encode_nodes) == 2  # pos + neg
    for enc in encode_nodes:
        assert "image1" in enc["inputs"]
        assert "image2" in enc["inputs"]


def test_multi_ref_face_uses_negative_prompt_to_block_image2_leakage():
    """face role 은 image2 의 hair/background/outfit transfer 를 negative 로 막는다."""
    from studio.comfy_api_builder import build_edit_api

    api_multi = build_edit_api(
        _make_edit_input(reference_filename="ref.png", reference_role="face")
    )

    negative_nodes = [
        n for n in api_multi.values()
        if n["class_type"] == "TextEncodeQwenImageEditPlus"
        and n.get("_meta", {}).get("title") == "Negative"
    ]

    assert len(negative_nodes) == 1
    neg_prompt = negative_nodes[0]["inputs"]["prompt"]
    assert "image2 hair" in neg_prompt
    assert "image2 background" in neg_prompt
    assert "image2 clothing" in neg_prompt
    assert "changing image1 body pose" in neg_prompt


def test_make_edit_prompt_passes_extra_upload_to_builder():
    """edit pipeline 의 _make_edit_prompt factory 가 extra_uploaded_names[0] 을
    build_edit_from_request 의 reference_image_filename 으로 정확히 전달."""
    from studio.comfy_api_builder import build_edit_from_request

    api = build_edit_from_request(
        prompt="test",
        source_filename="src.png",
        seed=1,
        lightning=False,
        reference_image_filename="ref.png",
        reference_role="face",
    )

    # multi-ref path 로 분기됐는지 — LoadImage 2개 (src + ref)
    load_nodes = [n for n in api.values() if n["class_type"] == "LoadImage"]
    assert len(load_nodes) == 2
    image_inputs = [n["inputs"]["image"] for n in load_nodes]
    assert "src.png" in image_inputs
    assert "ref.png" in image_inputs


def test_make_edit_prompt_no_extra_returns_single_path():
    """build_edit_from_request 의 reference_image_filename 이 None 이면 단일 path."""
    from studio.comfy_api_builder import build_edit_from_request

    api = build_edit_from_request(
        prompt="test",
        source_filename="src.png",
        seed=1,
        lightning=False,
        reference_image_filename=None,
        reference_role=None,
    )

    load_nodes = [n for n in api.values() if n["class_type"] == "LoadImage"]
    assert len(load_nodes) == 1
