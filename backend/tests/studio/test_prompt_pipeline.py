"""
prompt_pipeline._strip_repeat_noise 견고성 테스트 (2026-04-23).

gemma4-un 이 긴 출력에서 pipe/hyphen/word/phrase loop 에 빠지는 이슈에 대한
안전망(regex 기반 잘라내기) 동작 검증.

※ 2026-04-23 후속(Opus 리뷰): v3 전환으로 JSON 양방향 파싱 경로를 제거했으므로
   _parse_bilingual_response / _extract_broken_json_fields 테스트도 함께 삭제.
"""

from __future__ import annotations

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
