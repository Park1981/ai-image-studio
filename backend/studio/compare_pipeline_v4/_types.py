"""
compare_pipeline_v4._types — V4 결과 dataclass.

원칙:
  - to_dict() 는 snake_case (Python) → camelCase (JSON) 변환 — frontend 친화 (spec §8.2).
  - 빈 객체/리스트는 None 이 아니라 {}/[] 로 채움 — STRICT JSON 룰 (키 누락 금지).
  - fidelity_score / category_scores 의 None 은 그대로 직렬화 (빈 매핑 X).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class CompareCategoryDiff:
    """카테고리별 [image1 묘사 / image2 묘사 / 차이 묘사] 트리플 (en + ko 6 슬롯)."""

    image1: str
    image2: str
    diff: str
    image1_ko: str = ""
    image2_ko: str = ""
    diff_ko: str = ""

    def to_dict(self) -> dict[str, str]:
        """snake_case → camelCase 직렬화."""
        return {
            "image1": self.image1,
            "image2": self.image2,
            "diff": self.diff,
            "image1Ko": self.image1_ko,
            "image2Ko": self.image2_ko,
            "diffKo": self.diff_ko,
        }


@dataclass
class CompareKeyAnchor:
    """핵심 시각 앵커 (시선 방향 / 손 위치 등) — image1 vs image2 묘사."""

    label: str       # 짧은 phrase (en) — 번역 안 함
    image1: str
    image2: str
    image1_ko: str = ""
    image2_ko: str = ""

    def to_dict(self) -> dict[str, str]:
        """snake_case → camelCase 직렬화."""
        return {
            "label": self.label,
            "image1": self.image1,
            "image2": self.image2,
            "image1Ko": self.image1_ko,
            "image2Ko": self.image2_ko,
        }


@dataclass
class CompareAnalysisResultV4:
    """V4 결과 — frontend `VisionCompareAnalysisV4` interface 미러."""

    # ── 헤더 ───────────────────────────────────────────────────────────────
    summary_en: str
    summary_ko: str
    common_points_en: list[str]
    common_points_ko: list[str]
    key_differences_en: list[str]
    key_differences_ko: list[str]

    # ── 도메인 + 매트릭스 ──────────────────────────────────────────────────
    domain_match: str                               # "person" | "object_scene" | "mixed"
    category_diffs: dict[str, CompareCategoryDiff]  # 5 카테고리 또는 빈 dict (mixed)
    category_scores: dict[str, int | None]          # forward-compat (Phase 2 chip 펼침)
    key_anchors: list[CompareKeyAnchor]

    # ── 점수 + 변환 ────────────────────────────────────────────────────────
    fidelity_score: int | None                      # 0-100 또는 None (mixed 도메인)
    transform_prompt_en: str
    transform_prompt_ko: str
    uncertain_en: str
    uncertain_ko: str

    # ── 원본 observation (on-demand prompt_synthesize 재사용) ───────────────
    observation1: dict[str, Any]
    observation2: dict[str, Any]

    # ── 메타 ───────────────────────────────────────────────────────────────
    provider: str        # "ollama" | "fallback"
    fallback: bool
    analyzed_at: int     # ms epoch
    vision_model: str
    text_model: str

    def to_dict(self) -> dict[str, Any]:
        """snake_case → camelCase 직렬화 (spec §8.2).

        - dict / list 는 shallow copy 로 외부 mutation 방지.
        - fidelity_score / category_scores 의 None 은 그대로 유지 (키 누락 금지).
        """
        return {
            "summaryEn": self.summary_en,
            "summaryKo": self.summary_ko,
            "commonPointsEn": list(self.common_points_en),
            "commonPointsKo": list(self.common_points_ko),
            "keyDifferencesEn": list(self.key_differences_en),
            "keyDifferencesKo": list(self.key_differences_ko),
            "domainMatch": self.domain_match,
            "categoryDiffs": {k: v.to_dict() for k, v in self.category_diffs.items()},
            "categoryScores": dict(self.category_scores),
            "keyAnchors": [a.to_dict() for a in self.key_anchors],
            "fidelityScore": self.fidelity_score,
            "transformPromptEn": self.transform_prompt_en,
            "transformPromptKo": self.transform_prompt_ko,
            "uncertainEn": self.uncertain_en,
            "uncertainKo": self.uncertain_ko,
            "observation1": dict(self.observation1),
            "observation2": dict(self.observation2),
            "provider": self.provider,
            "fallback": self.fallback,
            "analyzedAt": self.analyzed_at,
            "visionModel": self.vision_model,
            "textModel": self.text_model,
        }
