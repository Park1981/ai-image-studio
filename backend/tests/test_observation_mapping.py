# backend/tests/test_observation_mapping.py
"""observation_mapping — observation JSON → 9 슬롯 5개 매핑 단위 테스트."""

from studio.vision_pipeline.observation_mapping import map_observation_to_slots


class TestObservationMapping:
    """observation 의 nested JSON 을 frontend 호환 5 슬롯으로 평탄화."""

    def test_full_observation_maps_all_slots(self) -> None:
        """완전한 observation 은 5 슬롯 모두 채운다."""
        observation = {
            "image_orientation": "portrait",
            "framing": {
                "crop": "chest-up",
                "camera_angle": "slight upward tilt",
                "subject_position": "center-left",
            },
            "subjects": [
                {
                    "count_index": 1,
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "East Asian female",
                    "face_direction": "facing camera",
                    "expression": "winking",
                    "hair": "long wet dark hair",
                    "pose": "drinking from cup",
                    "clothing": ["gray cropped tank top with cutouts", "beige cargo pants"],
                    "accessories_or_objects": ["clear plastic cup with yellow drink"],
                }
            ],
            "environment": {
                "location_type": "outdoor music festival at night",
                "foreground": ["crowd in plastic raincoats"],
                "background": ["MUSIC FESTIVAL neon sign", "stage with lights"],
                "weather_or_surface_condition": ["rain", "wet surfaces"],
            },
            "lighting_and_color": {
                "visible_light_sources": ["red stage lights", "blue stage lights"],
                "dominant_colors": ["red", "blue", "neon"],
                "contrast": "high contrast",
            },
            "photo_quality": {
                "depth_of_field": "shallow",
                "focus_target": "subject face and cup",
                "style_evidence": ["concert/event photography"],
            },
        }
        slots = map_observation_to_slots(observation)
        assert "portrait" in slots["composition"]
        assert "chest-up" in slots["composition"]
        assert "East Asian female" in slots["subject"]
        assert "winking" in slots["subject"]
        assert "cropped tank top" in slots["clothing_or_materials"]
        assert "cargo pants" in slots["clothing_or_materials"]
        assert "music festival" in slots["environment"]
        assert "rain" in slots["environment"]
        assert "red stage lights" in slots["lighting_camera_style"]
        assert "shallow" in slots["lighting_camera_style"]

    def test_empty_observation_returns_empty_slots(self) -> None:
        """빈 observation 은 빈 5 슬롯 반환 (None 아님)."""
        slots = map_observation_to_slots({})
        assert slots == {
            "composition": "",
            "subject": "",
            "clothing_or_materials": "",
            "environment": "",
            "lighting_camera_style": "",
        }

    def test_multi_subject_uses_numbered_format(self) -> None:
        """다중 subject 는 'subject 1; subject 2' 형식."""
        observation = {
            "subjects": [
                {"apparent_age_group": "young adult", "broad_visible_appearance": "female", "expression": "smiling"},
                {"apparent_age_group": "middle-aged", "broad_visible_appearance": "male", "expression": "neutral"},
            ]
        }
        slots = map_observation_to_slots(observation)
        assert "subject 1:" in slots["subject"]
        assert "subject 2:" in slots["subject"]
        assert "young adult female" in slots["subject"]
        assert "middle-aged male" in slots["subject"]

    def test_handles_subject_none_item_gracefully(self) -> None:
        """subjects[] 안 None 항목이 있어도 AttributeError 없이 처리된다 (LLM 비정상 출력 가드)."""
        observation = {
            "subjects": [
                None,
                {"apparent_age_group": "young adult", "broad_visible_appearance": "female"},
                None,
            ]
        }
        slots = map_observation_to_slots(observation)
        # None 은 skip, dict 만 처리 — enumerate idx=1 → "subject 2"
        assert "young adult female" in slots["subject"]
        assert "subject 2:" in slots["subject"]

    def test_handles_clothing_as_string_gracefully(self) -> None:
        """clothing 필드가 list 가 아닌 str 이어도 character-iterate 버그 안 발생 (LLM 비정상 출력 가드)."""
        observation = {
            "subjects": [
                {
                    "apparent_age_group": "young adult",
                    "clothing": "blue jeans",  # str (LLM 비정상 — list 가 정상)
                    "accessories_or_objects": "watch",  # str (비정상)
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        # str 은 skip — clothing_or_materials 빈 문자열
        assert slots["clothing_or_materials"] == ""
        # subject 는 정상 처리
        assert "young adult" in slots["subject"]
