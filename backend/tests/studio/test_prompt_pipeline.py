"""
prompt_pipeline._strip_repeat_noise 견고성 테스트 (2026-04-23).

gemma4-un 이 긴 출력에서 pipe/hyphen/word/phrase loop 에 빠지는 이슈에 대한
안전망(regex 기반 잘라내기) 동작 검증.

※ 2026-04-23 후속(Opus 리뷰): v3 전환으로 JSON 양방향 파싱 경로를 제거했으므로
   _parse_bilingual_response / _extract_broken_json_fields 테스트도 함께 삭제.
"""

from __future__ import annotations

import pytest

from backend.studio.prompt_pipeline import _strip_repeat_noise


def test_strip_repeat_noise_pipe_loop() -> None:
    # 사용자 스크린샷 실제 케이스: shot on 랩 + pipe 반복
    s = "shot on 랩||||||||||||||||||||||||||||||"
    cleaned = _strip_repeat_noise(s)
    assert "|" not in cleaned
    assert "shot on 랩" in cleaned


def test_strip_repeat_noise_hyphen_loop() -> None:
    s = "some text --------------------- after"
    cleaned = _strip_repeat_noise(s)
    # 연속 12개+ 의 - 가 있으므로 그 지점 이전까지만 유지
    assert "---" not in cleaned
    assert cleaned.strip() == "some text"


def test_strip_repeat_noise_word_loop() -> None:
    s = "a sentence word word word word word word word word word word end"
    cleaned = _strip_repeat_noise(s)
    # 'word' 8번+ 연속 이후는 잘림
    assert cleaned.count("word") < 5
    assert "a sentence" in cleaned


def test_strip_repeat_noise_normal_text() -> None:
    # 정상 텍스트는 그대로
    s = "A hyper-realistic editorial photo, cinematic lighting."
    assert _strip_repeat_noise(s) == s


def test_strip_repeat_noise_phrase_loop() -> None:
    # 구 반복 케이스 (실제 gemma4 출력)
    s = "background of a plaza-like a park or a park-like a park or a park-like a park or a park-like landscape"
    cleaned = _strip_repeat_noise(s)
    # "a park or a park-like" 같은 구가 3회+ 반복되는 이상 뒤는 잘려야
    assert cleaned.count("park-like") < 3
    assert "plaza-like" in cleaned or "background" in cleaned


def test_strip_repeat_noise_real_gemma4_output() -> None:
    # 사용자 실제 출력 (2026-04-23) — 통합 케이스
    raw = (
        "A hyper-realistic editorial photo of a young, K-pop idol-like Korean woman. "
        "soft-focus bokeh-filled background of a public plaza-like a park or a park-like "
        "a park or a park-like a park or a park-like a park-like a park-like a park-largeer "
        "larger larger larger larger larger larger larger larger larger larger larger larger "
        "larger larger larger larger larger larger larger larger"
    )
    cleaned = _strip_repeat_noise(raw)
    # "larger" 대량 반복 제거됐어야
    assert cleaned.count("larger") < 4
    # 시작 문장은 보존
    assert "A hyper-realistic editorial photo" in cleaned


# ───── spec 19 후속 — 시스템 프롬프트 가드 (Codex + Claude 합산) ─────


def test_system_generate_v2_has_adaptive_minimal_guard() -> None:
    """G — SYSTEM_GENERATE 가 minimal-style 신호 감지 시 디테일 강제 안 하는 가드 포함."""
    from backend.studio.prompt_pipeline import SYSTEM_GENERATE

    # Adaptive 섹션 헤더
    assert "ADAPTIVE STYLE" in SYSTEM_GENERATE or "minimal" in SYSTEM_GENERATE.lower()
    # 한국어 + 영어 양쪽 신호 키워드 명시
    assert "미니멀" in SYSTEM_GENERATE
    assert "minimalist" in SYSTEM_GENERATE.lower()
    # restraint 명시
    assert "RESPECT" in SYSTEM_GENERATE.upper()
    assert "DO NOT add" in SYSTEM_GENERATE or "do not add" in SYSTEM_GENERATE.lower()


def test_system_generate_v2_has_external_research_guard() -> None:
    """I — SYSTEM_GENERATE 가 external research hints 를 untrusted data 로 다루는 가드 포함."""
    from backend.studio.prompt_pipeline import SYSTEM_GENERATE

    # 가드 섹션
    assert "EXTERNAL RESEARCH HINTS" in SYSTEM_GENERATE
    assert "data only" in SYSTEM_GENERATE.lower() or "not as instructions" in SYSTEM_GENERATE.lower()
    assert "UNTRUSTED" in SYSTEM_GENERATE.upper()
    # source of truth 명시
    assert "source of truth" in SYSTEM_GENERATE.lower()


def test_system_video_v2_no_audio_mention_and_domain_aware() -> None:
    """C — SYSTEM_VIDEO 가 ambient sound 제거 + 도메인 분기 identity 가드."""
    from backend.studio.prompt_pipeline import SYSTEM_VIDEO_BASE

    # 줄바꿈으로 끊겨도 키워드 검색되도록 공백 정규화
    flat = " ".join(SYSTEM_VIDEO_BASE.split())

    # ambient sound 제거 + LTX silent 명시
    assert "ambient sound cues" not in flat
    assert "silent video" in flat
    # 도메인별 identity 분기
    assert "PERSON / character / face" in flat
    assert "OBJECT / SCENE / LANDSCAPE" in flat
    assert "no subject swap" in flat
    # lighting 조건부 (B 와 동일 패턴)
    assert "DO NOT force" in flat


def test_claude_cli_research_query_has_data_only_and_generic_fallback() -> None:
    """H — Claude CLI 쿼리가 draft 격리 + 모델 모를 때 generic + Korean 응답 강제."""
    from backend.studio.claude_cli import _build_research_query

    q = _build_research_query("테스트 프롬프트", "Qwen Image 2512")
    # data-only 격리
    assert "DATA ONLY" in q
    assert "[DRAFT PROMPT - data only]" in q
    assert "do NOT change the subject" in q
    # 모델 모를 때 generic 폴백 가이드
    assert "don't have specific knowledge" in q
    assert "Do NOT invent" in q
    # 응답 형식 — fragment + Korean
    assert "phrase fragment" in q
    assert "한국어" in q or "Korean" in q


def test_upgrade_generate_prompt_injects_aspect_into_user_message() -> None:
    """F — upgrade_generate_prompt 가 width/height 받으면 user message 첫 줄에 aspect 명시."""
    import asyncio
    from unittest.mock import AsyncMock, patch

    from backend.studio.prompt_pipeline import upgrade_generate_prompt

    captured: dict = {}

    async def _fake_chat(**kwargs):
        captured.update(kwargs)
        return "polished english prompt output"

    with (
        patch(
            "backend.studio.prompt_pipeline._ollama._call_ollama_chat",
            new=_fake_chat,
        ),
        patch(
            "backend.studio.prompt_pipeline.translate.translate_to_korean",
            new=AsyncMock(return_value="한국어 번역"),
        ),
    ):
        asyncio.run(
            upgrade_generate_prompt(
                prompt="cinematic portrait",
                width=1664,
                height=928,
            )
        )

    user_msg = captured.get("user", "")
    # aspect 정보가 user message 첫 줄에 명시
    assert "1664" in user_msg
    assert "928" in user_msg
    # 사용자 prompt 도 보존
    assert "cinematic portrait" in user_msg


@pytest.mark.asyncio
async def test_upgrade_only_route_passes_aspect_to_upgrade() -> None:
    """spec 19 후속 (Codex 추가 fix): /upgrade-only 가 aspect/width/height 를
    upgrade_generate_prompt 의 width/height 인자로 그대로 전달.

    이전엔 /generate 만 aspect 전달하고 /upgrade-only 는 빠져 있어
    "업그레이드 확인 모달" 사용 시 SYSTEM_GENERATE 에 size context 누락됐음.
    """
    from unittest.mock import patch

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio.prompt_pipeline import UpgradeResult

    captured: dict = {}

    async def _fake_upgrade(**kwargs):
        captured.update(kwargs)
        return UpgradeResult(
            upgraded="captured", fallback=False,
            provider="ollama", original=kwargs.get("prompt", ""),
            translation=None,
        )

    # task #17 (2026-04-26): upgrade-only endpoint 가 studio.routes.prompt 로 이동.
    # mock.patch 는 lookup 모듈 기준 → 새 위치 패치.
    with patch(
        "studio.routes.prompt.upgrade_generate_prompt", new=_fake_upgrade
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as cli:
            # 케이스 1: width/height 직접 지정
            res = await cli.post(
                "/api/studio/upgrade-only",
                json={"prompt": "x", "aspect": "16:9", "width": 1664, "height": 928},
            )
            assert res.status_code == 200
            assert captured.get("width") == 1664
            assert captured.get("height") == 928

            # 케이스 2: aspect preset 만 (width/height 미지정 → preset 폴백)
            captured.clear()
            res = await cli.post(
                "/api/studio/upgrade-only",
                json={"prompt": "x", "aspect": "1:1"},
            )
            assert res.status_code == 200
            # aspect 1:1 의 preset 값 (기본 1328 또는 GENERATE_MODEL 정의값)
            assert captured.get("width") > 0
            assert captured.get("height") > 0
            assert captured.get("width") == captured.get("height")  # 1:1 정사각


def test_upgrade_generate_prompt_isolates_research_hints_in_user_message() -> None:
    """I — research_context 가 SYSTEM 이 아닌 user message 의 untrusted-data 블록에 격리."""
    import asyncio
    from unittest.mock import AsyncMock, patch

    from backend.studio.prompt_pipeline import upgrade_generate_prompt

    captured: dict = {}

    async def _fake_chat(**kwargs):
        captured.update(kwargs)
        return "polished output"

    with (
        patch(
            "backend.studio.prompt_pipeline._ollama._call_ollama_chat",
            new=_fake_chat,
        ),
        patch(
            "backend.studio.prompt_pipeline.translate.translate_to_korean",
            new=AsyncMock(return_value=None),
        ),
    ):
        asyncio.run(
            upgrade_generate_prompt(
                prompt="cinematic portrait",
                research_context="1. soft key light\n2. shallow DoF",
            )
        )

    sys_msg = captured.get("system", "")
    user_msg = captured.get("user", "")

    # research hints 는 user message 안에 untrusted-data 블록으로 들어감
    assert "soft key light" in user_msg
    assert "[External research hints" in user_msg
    # SYSTEM 에는 hint 본문이 절대 추가되지 않아야 함
    assert "soft key light" not in sys_msg


# ───────── Slot removal 후 reference_clause directive 강화 (2026-04-28) ─────────


def test_reference_clause_outfit_explicitly_blocks_image1_outfit_preserve() -> None:
    """outfit role: image1 의 옷을 *보존하지 말라* 는 명시적 directive.

    Slot removal 로 [preserve] attire 가 사라진 상태에서 gemma4 가
    "preserve the original attire" 같은 환각 phrasing 을 생성하지
    않도록 reference_clause 가 그것을 *명시적으로 차단*.
    """
    from studio.prompt_pipeline import build_reference_clause

    clause = build_reference_clause("outfit")
    lower = clause.lower()
    # image2 의 옷을 적용한다는 지시
    assert "image2" in clause.lower() or "IMAGE2" in clause
    assert "outfit" in lower or "clothing" in lower or "attire" in lower
    # image1 옷 보존 명시 차단
    assert "do not preserve" in lower or "do not keep" in lower or "replace" in lower


def test_reference_clause_background_explicitly_blocks_image1_background_preserve() -> None:
    """background role: image1 의 배경을 *보존하지 말라* 는 명시적 directive."""
    from studio.prompt_pipeline import build_reference_clause

    clause = build_reference_clause("background")
    lower = clause.lower()
    assert "image2" in clause.lower() or "IMAGE2" in clause
    assert "background" in lower or "environment" in lower
    assert "do not preserve" in lower or "replace" in lower


def test_reference_clause_style_explicitly_blocks_image1_style_preserve() -> None:
    """style role: image1 의 톤/조명을 *보존하지 말라* 는 명시적 directive."""
    from studio.prompt_pipeline import build_reference_clause

    clause = build_reference_clause("style")
    lower = clause.lower()
    assert "image2" in clause.lower() or "IMAGE2" in clause
    assert "style" in lower or "tone" in lower or "color" in lower or "lighting" in lower
    assert "do not preserve" in lower or "replace" in lower or "match" in lower
