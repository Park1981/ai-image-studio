"""V4 JSON 정규화 helper (vision_pipeline observation_mapping 패턴 재사용)."""

import pytest

from studio.compare_pipeline_v4._coerce import (
    coerce_category_diff,
    coerce_domain_match,
    coerce_fidelity_score,
    coerce_key_anchor,
    coerce_str_list,
)


# domain_match
@pytest.mark.parametrize("inp,expected", [
    ("person", "person"),
    ("PERSON", "person"),
    ("  Object_Scene  ", "object_scene"),
    ("mixed", "mixed"),
    ("invalid", "mixed"),         # unknown → mixed (보수적 fallback)
    (None, "mixed"),
    ("", "mixed"),
])
def test_coerce_domain_match(inp, expected):
    assert coerce_domain_match(inp) == expected


# fidelity_score
@pytest.mark.parametrize("inp,expected", [
    (87, 87),
    ("75", 75),
    (105, 100),                    # clamp 0-100
    (-3, 0),
    (None, None),
    ("null", None),
    ("abc", None),
    (50.7, 50),                    # float → int
])
def test_coerce_fidelity_score(inp, expected):
    assert coerce_fidelity_score(inp) == expected


# str list — sentinel filter
def test_coerce_str_list_sentinel_filter():
    out = coerce_str_list([
        "real point",
        "none",                    # sentinel
        "",                        # 빈
        "n/a",                     # sentinel
        "another real",
        None,                      # 비문자열
    ])
    assert out == ["real point", "another real"]


def test_coerce_str_list_max_n():
    out = coerce_str_list(["a"] * 20, max_n=6)
    assert len(out) == 6


def test_coerce_str_list_non_list():
    assert coerce_str_list(None) == []
    assert coerce_str_list("string") == []
    assert coerce_str_list({"a": 1}) == []


# category_diff
def test_coerce_category_diff_full():
    raw = {"image1": "A", "image2": "B", "diff": "C"}
    d = coerce_category_diff(raw)
    assert d.image1 == "A"
    assert d.image2 == "B"
    assert d.diff == "C"
    assert d.image1_ko == ""


def test_coerce_category_diff_missing_keys():
    """모델이 일부 키 누락한 경우 — 빈 문자열로 채움 (parser KeyError 방지)."""
    d = coerce_category_diff({"image1": "only"})
    assert d.image1 == "only"
    assert d.image2 == ""
    assert d.diff == ""


def test_coerce_category_diff_non_dict():
    d = coerce_category_diff(None)
    assert d.image1 == "" and d.image2 == "" and d.diff == ""


# key_anchor
def test_coerce_key_anchor():
    a = coerce_key_anchor({"label": "gaze", "image1": "L", "image2": "R"})
    assert a.label == "gaze" and a.image1 == "L" and a.image2 == "R"


def test_coerce_key_anchor_missing_label():
    a = coerce_key_anchor({"image1": "L", "image2": "R"})
    assert a.label == ""
