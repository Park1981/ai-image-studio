"""V4 dataclass + to_dict camelCase 변환 검증."""

from studio.compare_pipeline_v4._types import (
    CompareAnalysisResultV4,
    CompareCategoryDiff,
    CompareKeyAnchor,
)


def test_category_diff_to_dict_camel_case():
    d = CompareCategoryDiff(
        image1="A", image2="B", diff="C",
        image1_ko="가", image2_ko="나", diff_ko="다",
    )
    out = d.to_dict()
    assert out == {
        "image1": "A", "image2": "B", "diff": "C",
        "image1Ko": "가", "image2Ko": "나", "diffKo": "다",
    }


def test_key_anchor_to_dict_camel_case():
    a = CompareKeyAnchor(
        label="gaze", image1="left", image2="right",
        image1_ko="왼쪽", image2_ko="오른쪽",
    )
    out = a.to_dict()
    assert out == {
        "label": "gaze", "image1": "left", "image2": "right",
        "image1Ko": "왼쪽", "image2Ko": "오른쪽",
    }


def test_result_v4_to_dict_full_camel_case():
    r = CompareAnalysisResultV4(
        summary_en="EN", summary_ko="KO",
        common_points_en=["c1"], common_points_ko=["공1"],
        key_differences_en=["d1"], key_differences_ko=["차1"],
        domain_match="person",
        category_diffs={
            "composition": CompareCategoryDiff(
                image1="x1", image2="x2", diff="x3",
                image1_ko="아", image2_ko="이", diff_ko="우",
            ),
        },
        category_scores={"composition": 87},
        key_anchors=[
            CompareKeyAnchor(
                label="gaze", image1="L", image2="R",
                image1_ko="좌", image2_ko="우",
            ),
        ],
        fidelity_score=87,
        transform_prompt_en="apply X",
        transform_prompt_ko="X 적용",
        uncertain_en="",
        uncertain_ko="",
        observation1={"raw1": "obs1"},
        observation2={"raw2": "obs2"},
        provider="ollama",
        fallback=False,
        analyzed_at=1700000000000,
        vision_model="qwen3-vl:8b",
        text_model="gemma4-un:latest",
    )
    out = r.to_dict()
    expected_keys = {
        "summaryEn", "summaryKo",
        "commonPointsEn", "commonPointsKo",
        "keyDifferencesEn", "keyDifferencesKo",
        "domainMatch", "categoryDiffs", "categoryScores",
        "keyAnchors", "fidelityScore",
        "transformPromptEn", "transformPromptKo",
        "uncertainEn", "uncertainKo",
        "observation1", "observation2",
        "provider", "fallback", "analyzedAt",
        "visionModel", "textModel",
    }
    assert set(out.keys()) == expected_keys
    assert out["categoryDiffs"]["composition"]["image1Ko"] == "아"
    assert out["fidelityScore"] == 87


def test_result_v4_mixed_domain_empty_category_diffs():
    r = CompareAnalysisResultV4(
        summary_en="", summary_ko="",
        common_points_en=[], common_points_ko=[],
        key_differences_en=[], key_differences_ko=[],
        domain_match="mixed",
        category_diffs={},   # 빈 dict — 키 누락 X
        category_scores={},
        key_anchors=[],
        fidelity_score=None,
        transform_prompt_en="", transform_prompt_ko="",
        uncertain_en="", uncertain_ko="",
        observation1={}, observation2={},
        provider="ollama", fallback=False,
        analyzed_at=0, vision_model="qwen3-vl:8b",
        text_model="gemma4-un:latest",
    )
    out = r.to_dict()
    assert out["categoryDiffs"] == {}
    assert out["fidelityScore"] is None
