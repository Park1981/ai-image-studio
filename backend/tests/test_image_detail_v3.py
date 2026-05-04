# backend/tests/test_image_detail_v3.py
"""image_detail.analyze_image_detailed v3 통합 테스트 (2-stage 분업 · 2026-05-03).

Phase 5 신규 4개 시나리오:
  1. 전체 성공 경로 — vision + text 모두 정상 → 9 슬롯 채워짐
  2. vision 실패 → fallback=True (text 호출 안 함)
  3. text 합성 실패 → observation 기반 짧은 positive 자동 합성 (빈 문자열 X)
  4. banned_terms 필터 적용 — observation 근거 없는 boilerplate 제거 확인
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from studio.vision_pipeline.image_detail import (
    VisionAnalysisResult,
    analyze_image_detailed,
)


@pytest.mark.asyncio
class TestAnalyzeImageDetailedV3:
    """2-stage 통합 — vision_observe → prompt_synthesize → banned_terms → mapping."""

    async def test_full_success_path(self) -> None:
        """vision + text 모두 성공 → 9 슬롯 다 채워짐."""
        mock_observation: dict[str, Any] = {
            "image_orientation": "portrait",
            "framing": {"crop": "chest-up", "camera_angle": "slight upward"},
            "subjects": [
                {
                    "count_index": 1,
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "East Asian female",
                    "expression": "winking",  # 옛 슬롯 — backward compat 검증용 유지
                    "hair": "long wet dark hair",
                    "clothing": ["gray cropped tank with cutouts"],  # 옛 슬롯 — fallback 검증용 유지
                    # ── Recall Phase 1 새 슬롯 (우선 매핑 대상) ──
                    "face_detail": {
                        "eye_state": "winking",
                        "left_eye": "open",
                        "right_eye": "closed",
                        "mouth_state": "cup raised to lips",
                        "expression_notes": ["one eye closed", "drinking"],
                    },
                    "object_interaction": {
                        "object": "clear plastic cup",
                        "object_position_relative_to_face": "raised to lips",
                        "action": "drinking",
                    },
                    "clothing_detail": {
                        "top_color": "gray",
                        "strap_layout": "asymmetric cross-strap",
                        "cutouts_or_openings": "side cutouts",
                        "top_type": "cropped tank top",
                        "bottom_color": "beige",
                        "bottom_type": "cargo pants",
                        "bottom_style_details": ["utility pockets"],
                    },
                }
            ],
            "environment": {
                "location_type": "music festival outdoor at night",
                "background": ["neon MUSIC FESTIVAL sign"],
                # ── Recall Phase 1 새 슬롯 ──
                "crowd_detail": {
                    "raincoats_or_ponchos": "transparent plastic raincoats",
                    "crowd_clothing": ["wet hair"],
                },
            },
            "lighting_and_color": {
                "visible_light_sources": ["red stage lights", "blue stage lights"],
                "dominant_colors": ["red", "blue"],
            },
            "photo_quality": {"depth_of_field": "shallow"},
        }
        mock_synthesized = {
            "summary": "East Asian young adult woman at music festival.",
            "positive_prompt": "young adult fictional East Asian woman, winking, ...",
            "negative_prompt": "smiling, dry hair, studio background",
            "key_visual_anchors": ["wet hair", "winking", "neon stage"],
            "uncertain": ["drink type"],
        }
        with (
            patch(
                "studio.vision_pipeline.image_detail._vo.observe_image",
                new=AsyncMock(return_value=mock_observation),
            ),
            patch(
                "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
                new=AsyncMock(return_value=mock_synthesized),
            ),
            patch(
                "studio.vision_pipeline.image_detail.translate_to_korean",
                new=AsyncMock(return_value="동아시아 젊은 성인 여성이 음악 페스티벌에 있다."),
            ),
        ):
            result = await analyze_image_detailed(
                b"fake_image",
                width=832,
                height=1248,
                timeout=120.0,
            )

        assert isinstance(result, VisionAnalysisResult)
        assert result.fallback is False
        assert result.provider == "ollama"
        assert "winking" in result.positive_prompt
        assert result.summary == mock_synthesized["summary"]
        assert "smiling" in result.negative_prompt
        # observation 매핑 5 슬롯
        assert "East Asian female" in result.subject
        assert "music festival" in result.environment
        assert "red stage lights" in result.lighting_camera_style
        assert "cropped tank" in result.clothing_or_materials
        assert "chest-up" in result.composition
        assert result.uncertain == "drink type"
        assert result.ko is not None and "음악" in result.ko
        # ── Recall Phase 1-3 새 슬롯 우선 매핑 검증 ──
        # face_detail 경로 — eye_state + mouth_state + expression_notes
        assert "winking" in result.subject
        assert "cup raised to lips" in result.subject  # face_detail.mouth_state
        assert "one eye closed" in result.subject  # face_detail.expression_notes[0]
        # clothing_detail 우선 매핑 (옛 clothing[] 대신)
        assert "asymmetric cross-strap" in result.clothing_or_materials
        assert "side cutouts" in result.clothing_or_materials
        assert "cargo pants" in result.clothing_or_materials
        # object_interaction 은 v3 부터 의상 → 피사체 카드 (interaction: 라벨) 로 이동
        assert "raised to lips" in result.subject
        assert "interaction:" in result.subject
        # 의상 카드에는 더 이상 안 들어감 (cup/drinking 누수 차단)
        assert "raised to lips" not in result.clothing_or_materials
        # crowd_detail → environment 흡수
        assert "transparent plastic raincoats" in result.environment

    async def test_vision_failure_returns_fallback(self) -> None:
        """vision 호출 실패 → fallback=True (text 호출 안 함)."""
        with (
            patch(
                "studio.vision_pipeline.image_detail._vo.observe_image",
                new=AsyncMock(return_value={}),
            ),
            patch(
                "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
                new=AsyncMock(return_value={}),
            ) as mock_synth,
        ):
            result = await analyze_image_detailed(
                b"fake",
                width=512,
                height=512,
            )
        assert result.fallback is True
        assert result.provider == "fallback"
        assert result.positive_prompt == ""
        mock_synth.assert_not_called()

    async def test_text_failure_uses_observation_fallback_positive(self) -> None:
        """text 합성 실패 → observation 기반 짧은 positive 자동 합성 (빈 문자열 X)."""
        mock_observation = {
            "subjects": [
                {
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "Caucasian male",
                    # Recall Phase 1-3 검증 — 새 clothing_detail 일부 추가
                    "clothing_detail": {
                        "top_color": "white",
                        "top_type": "t-shirt",
                    },
                }
            ],
            "environment": {"location_type": "studio"},
            "lighting_and_color": {"visible_light_sources": ["softbox key light"]},
        }
        with (
            patch(
                "studio.vision_pipeline.image_detail._vo.observe_image",
                new=AsyncMock(return_value=mock_observation),
            ),
            patch(
                "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
                new=AsyncMock(
                    return_value={
                        "summary": "",
                        "positive_prompt": "",
                        "negative_prompt": "",
                        "key_visual_anchors": [],
                        "uncertain": [],
                    }
                ),
            ),
            patch(
                "studio.vision_pipeline.image_detail.translate_to_korean",
                new=AsyncMock(return_value=None),
            ),
        ):
            result = await analyze_image_detailed(
                b"fake",
                width=512,
                height=512,
            )
        # text 실패라 fallback 은 아님 (vision 은 성공)
        assert result.fallback is False
        # ChatGPT 2차 리뷰 — text 실패해도 positive 빈 문자열 X (observation 기반 합성)
        assert result.positive_prompt != ""
        assert "Caucasian male" in result.positive_prompt
        assert "studio" in result.positive_prompt
        assert "softbox key light" in result.positive_prompt
        assert "realistic photo" in result.positive_prompt
        # summary 도 observation 기반 1 문장 fallback
        assert "Caucasian male" in result.summary
        # observation 5 슬롯은 그대로
        assert "Caucasian male" in result.subject
        assert "studio" in result.environment
        # 새 clothing_detail 도 fallback positive 에 흡수됨 (Phase 1-3 검증)
        assert "white" in result.positive_prompt or "t-shirt" in result.positive_prompt.lower()

    async def test_banned_terms_filter_applied(self) -> None:
        """positive_prompt 안 boilerplate 가 observation 근거 없으면 제거된다."""
        mock_observation = {
            "subjects": [{}],
            "lighting_and_color": {
                "visible_light_sources": ["neon stage lights"],
                "dominant_colors": ["red", "blue"],
            },
        }
        mock_synthesized = {
            "summary": "Subject at neon scene.",
            # positive_prompt 안에 banned 'muted earth tones' 박혀있음 — observation 에 근거 없음
            "positive_prompt": "subject standing, muted earth tones, neon background",
            "negative_prompt": "",
            "key_visual_anchors": [],
            "uncertain": [],
        }
        with (
            patch(
                "studio.vision_pipeline.image_detail._vo.observe_image",
                new=AsyncMock(return_value=mock_observation),
            ),
            patch(
                "studio.vision_pipeline.image_detail._ps.synthesize_prompt",
                new=AsyncMock(return_value=mock_synthesized),
            ),
            patch(
                "studio.vision_pipeline.image_detail.translate_to_korean",
                new=AsyncMock(return_value=None),
            ),
        ):
            result = await analyze_image_detailed(
                b"fake",
                width=512,
                height=512,
            )
        assert "muted earth tones" not in result.positive_prompt.lower()
        assert "neon" in result.positive_prompt
