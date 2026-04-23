"""
prompt_pipeline 파서 견고성 테스트 (2026-04-23).

핵심: gemma4 가 JSON loop 에 빠진 응답도 복구해야 함.
"""

from __future__ import annotations

from backend.studio.prompt_pipeline import (
    _extract_broken_json_fields,
    _parse_bilingual_response,
    _strip_repeat_noise,
)


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


def test_parse_clean_json() -> None:
    raw = '{"en": "A photo of a cat.", "ko": "고양이 사진."}'
    en, ko = _parse_bilingual_response(raw)
    assert en == "A photo of a cat."
    assert ko == "고양이 사진."


def test_parse_json_with_code_fence() -> None:
    raw = '```json\n{"en": "foo", "ko": "푸"}\n```'
    en, ko = _parse_bilingual_response(raw)
    assert en == "foo"
    assert ko == "푸"


def test_parse_broken_json_pipe_loop() -> None:
    # gemma4 가 pipe loop 에 빠진 실제 재현 케이스
    raw = '{"en": "A hyper-realistic photo of a young woman, shot on 랩||||||||||||||||||||'
    en, ko = _parse_bilingual_response(raw)
    # pipe 노이즈 제거됐고 en 가 유효하게 복원
    assert "|" not in en
    assert "hyper-realistic" in en
    assert ko is None


def test_parse_broken_json_missing_closing_brace() -> None:
    raw = '{"en": "incomplete json", "ko": "미완 번역"'
    en, ko = _parse_bilingual_response(raw)
    # 정규식으로 en/ko 복원돼야 함
    assert "incomplete json" in en
    assert ko == "미완 번역"


def test_parse_empty_input() -> None:
    en, ko = _parse_bilingual_response("")
    assert en == ""
    assert ko is None


def test_parse_plain_text_no_json() -> None:
    # JSON 없이 그냥 텍스트만 오면 전체를 en 으로 폴백
    raw = "Just a plain English prompt without JSON wrapper."
    en, ko = _parse_bilingual_response(raw)
    assert en == raw
    assert ko is None


def test_parse_json_with_surrounding_text() -> None:
    # 모델이 앞뒤에 자연어 붙인 경우
    raw = 'Here is the result:\n{"en": "foo", "ko": "푸"}\nDone.'
    en, ko = _parse_bilingual_response(raw)
    assert en == "foo"
    assert ko == "푸"


def test_extract_broken_fields_en_only() -> None:
    raw = '{"en": "prompt text"'  # ko 가 아예 없음
    en, ko = _extract_broken_json_fields(raw)
    assert "prompt text" in en
    assert ko is None


def test_extract_broken_fields_both_closed() -> None:
    raw = '{"en": "one", "ko": "하나"}'
    en, ko = _extract_broken_json_fields(raw)
    assert en == "one"
    assert ko == "하나"
