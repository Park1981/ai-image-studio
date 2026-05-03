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

    # ─── Phase 3 (Recall): 새 슬롯 흡수 + 옛 슬롯 fallback 단위 테스트 ───

    def test_face_detail_new_slot_takes_priority_over_old_expression(self) -> None:
        """face_detail.eye_state 가 채워지면 옛 expression 보다 우선 매핑된다."""
        observation = {
            "subjects": [
                {
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "East Asian female",
                    "expression": "neutral",  # 옛
                    "face_detail": {
                        "eye_state": "winking",  # 새 — 우선
                        "mouth_state": "cup at lips",
                        "expression_notes": ["one eye closed"],
                    },
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        assert "winking" in slots["subject"]
        assert "cup at lips" in slots["subject"]
        assert "one eye closed" in slots["subject"]

    def test_clothing_detail_new_slot_with_object_interaction(self) -> None:
        """clothing_detail + object_interaction 새 슬롯이 clothing_or_materials 에 흡수된다."""
        observation = {
            "subjects": [
                {
                    "apparent_age_group": "young adult",
                    "clothing_detail": {
                        "top_color": "gray",
                        "strap_layout": "asymmetric cross-strap",
                        "cutouts_or_openings": "side cutouts",
                        "top_type": "cropped tank top",
                        "bottom_color": "beige",
                        "bottom_type": "cargo pants",
                        "bottom_style_details": ["utility pockets"],
                    },
                    "object_interaction": {
                        "object": "clear plastic cup",
                        "object_position_relative_to_face": "raised to lips",
                        "action": "drinking",
                    },
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        assert "asymmetric cross-strap" in slots["clothing_or_materials"]
        assert "side cutouts" in slots["clothing_or_materials"]
        assert "cargo pants" in slots["clothing_or_materials"]
        assert "raised to lips" in slots["clothing_or_materials"]

    def test_crowd_detail_absorbed_into_environment(self) -> None:
        """crowd_detail 새 슬롯이 environment 에 흡수된다."""
        observation = {
            "environment": {
                "location_type": "music festival",
                "background": ["stage with neon sign"],
                "crowd_detail": {
                    "raincoats_or_ponchos": "transparent plastic raincoats",
                    "crowd_clothing": ["wet hair", "casual summer clothes"],
                    "people_visible": "dense crowd",
                },
            }
        }
        slots = map_observation_to_slots(observation)
        assert "music festival" in slots["environment"]
        assert "transparent plastic raincoats" in slots["environment"]
        assert "dense crowd" in slots["environment"]

    def test_old_expression_fallback_when_face_detail_empty(self) -> None:
        """face_detail 새 슬롯 비어있으면 옛 expression 으로 fallback (backward compat)."""
        observation = {
            "subjects": [
                {
                    "apparent_age_group": "middle-aged",
                    "expression": "smiling",  # 옛 — face_detail 없으니 fallback
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        assert "smiling" in slots["subject"]
        assert "middle-aged" in slots["subject"]
