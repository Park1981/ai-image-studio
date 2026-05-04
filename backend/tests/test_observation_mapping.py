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
        # None 은 skip, dict 1개만 처리 → 단일이라 'subject N:' prefix 생략 (v3.1)
        assert "young adult female" in slots["subject"]
        assert "subject 1:" not in slots["subject"]
        assert "subject 2:" not in slots["subject"]

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
        """clothing_detail 은 의상 카드, object_interaction 은 피사체 카드 (v3 분리)."""
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
        # 의상 카드: clothing_detail 만 sub-label 로 (top: ... · bottom: ...)
        assert "asymmetric cross-strap" in slots["clothing_or_materials"]
        assert "side cutouts" in slots["clothing_or_materials"]
        assert "cargo pants" in slots["clothing_or_materials"]
        assert "top:" in slots["clothing_or_materials"]
        assert "bottom:" in slots["clothing_or_materials"]
        # object_interaction (cup raised to lips) 은 의상 카드에 X
        assert "raised to lips" not in slots["clothing_or_materials"]
        assert "drinking" not in slots["clothing_or_materials"]
        # 대신 피사체 카드의 interaction: 라벨로 이동
        assert "interaction:" in slots["subject"]
        assert "raised to lips" in slots["subject"]
        assert "drinking" in slots["subject"]

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

    # ─── v3 fix (2026-05-04 · sub-label prefix + sentinel filter) ───

    def test_v3_sentinel_filter_removes_placeholders_only(self) -> None:
        """SENTINEL_VALUES 는 의미 없는 placeholder 만 차단 — yes/no/true/false 는 보존."""
        observation = {
            "framing": {
                "crop": "close-up",
                "camera_angle": "none",       # sentinel — drop
                "subject_position": "centered",
            },
            "lighting_and_color": {
                "visible_light_sources": ["neon signs", "n/a"],  # n/a sentinel
                "dominant_colors": ["red", "blue", "unknown"],   # unknown sentinel
                "contrast": "high",                              # 살아남
            },
            "photo_quality": {
                "depth_of_field": "shallow",                     # 살아남
                "focus_target": "subject",                       # 단독은 drop
                "style_evidence": ["none", "not specified"],     # 둘 다 sentinel
            },
        }
        slots = map_observation_to_slots(observation)
        # composition: angle "none" drop, 나머지 살아남
        assert "crop: close-up" in slots["composition"]
        assert "angle:" not in slots["composition"]   # angle 라벨 자체가 사라짐 (값 drop)
        assert "position: centered" in slots["composition"]
        # lighting: contrast/dof 살림 + sentinel 4건 모두 drop
        assert "contrast: high" in slots["lighting_camera_style"]
        assert "dof: shallow" in slots["lighting_camera_style"]
        assert "focus:" not in slots["lighting_camera_style"]    # "subject" 단독 drop
        assert "style:" not in slots["lighting_camera_style"]    # ["none","not specified"] 모두 drop
        assert "n/a" not in slots["lighting_camera_style"]
        assert "unknown" not in slots["lighting_camera_style"]
        assert "none" not in slots["lighting_camera_style"]

    def test_v3_subject_sub_label_prefix(self) -> None:
        """피사체 카드는 face/eyes/mouth/expression/hair/pose/hands/interaction sub-label."""
        observation = {
            "subjects": [
                {
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "East Asian female",
                    "face_direction": "forward",
                    "face_detail": {
                        "eye_state": "both open",
                        "mouth_state": "closed",
                        "expression_notes": ["calm"],
                    },
                    "expression": "neutral",
                    "hair": "long, dark, wet",
                    "pose": "standing",
                    "hands": "holding a cup",
                    "object_interaction": {
                        "object": "cup",
                        "object_position_relative_to_face": "raised to lips",
                        "action": "drinking",
                    },
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        s = slots["subject"]
        # v3.1: 단일 인물은 'subject N:' prefix 생략
        assert "subject 1:" not in s
        assert "young adult East Asian female —" in s
        assert "face: forward" in s
        assert "eyes: both open" in s
        assert "mouth: closed" in s
        # expression: 옛 expression "neutral" + expression_notes "calm" 합본
        assert "expression: neutral / calm" in s or "expression: neutral" in s
        assert "hair: long, dark, wet" in s
        assert "pose: standing" in s
        assert "hands: holding a cup" in s
        assert "interaction: cup, raised to lips, drinking" in s

    def test_v3_accessories_drops_object_interaction_duplicate(self) -> None:
        """accessories 에서 object_interaction.object 와 중복되는 항목 (cup) 제거 (v3)."""
        observation = {
            "subjects": [
                {
                    "apparent_age_group": "young adult",
                    "clothing_detail": {
                        "top_color": "white",
                        "top_type": "shirt",
                    },
                    "accessories_or_objects": ["clear plastic cup", "necklace", "watch"],
                    "object_interaction": {
                        "object": "cup",
                        "object_position_relative_to_face": "raised to lips",
                        "action": "drinking",
                    },
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        # cup 은 interaction 에만, accessories 에는 necklace + watch 만
        assert "interaction: cup" in slots["subject"]
        assert "accessories:" in slots["clothing_or_materials"]
        assert "necklace" in slots["clothing_or_materials"]
        assert "watch" in slots["clothing_or_materials"]
        assert "clear plastic cup" not in slots["clothing_or_materials"]

    def test_v3_raincoats_dedup_between_foreground_and_crowd_detail(self) -> None:
        """env.foreground 의 raincoat 항목은 crowd_detail.raincoats_or_ponchos 가 잡혔을 때 dedup."""
        observation = {
            "environment": {
                "location_type": "outdoor festival",
                "foreground": ["plastic raincoats", "wet ground", "stage lights"],
                "crowd_detail": {
                    "raincoats_or_ponchos": "transparent raincoats",
                    "people_visible": "dense crowd",
                },
            }
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        # raincoats 한 번만 등장 (foreground 의 "plastic raincoats" 는 dedup 됨 → crowd 만 남음)
        assert env.count("raincoats") == 1
        assert "transparent raincoats" in env
        assert "plastic raincoats" not in env
        # foreground 의 다른 항목은 보존
        assert "wet ground" in env
        assert "stage lights" in env
        # people_visible descriptor 는 그대로
        assert "dense crowd" in env

    def test_v3_lighting_label_regression(self) -> None:
        """lighting 카드: contrast/dof 살아남기 + style sentinel 제거 + focus 'subject' drop."""
        observation = {
            "lighting_and_color": {
                "visible_light_sources": ["neon signs", "stage lights"],
                "dominant_colors": ["red", "blue", "gray"],
                "contrast": "high",
            },
            "photo_quality": {
                "depth_of_field": "shallow",
                "focus_target": "subject",  # 단독 → drop
                "style_evidence": ["none"],  # sentinel → drop
            },
        }
        slots = map_observation_to_slots(observation)
        l = slots["lighting_camera_style"]
        # 라벨 prefix + contrast/dof 살아있음 (sentinel 로 잘못 제거되면 안 됨)
        assert "lights: neon signs, stage lights" in l
        assert "colors: red, blue, gray" in l
        assert "contrast: high" in l
        assert "dof: shallow" in l
        # 너무 기본값인 focus="subject" 단독 → drop
        assert "focus:" not in l
        # style_evidence=["none"] → 전체 라벨 drop
        assert "style:" not in l
        assert "none" not in l

    def test_v3_focus_target_keeps_specific_descriptor(self) -> None:
        """focus_target='subject face and cup' 처럼 구체적이면 보존."""
        observation = {
            "photo_quality": {
                "focus_target": "subject face and cup",
            }
        }
        slots = map_observation_to_slots(observation)
        assert "focus: subject face and cup" in slots["lighting_camera_style"]

    # ─── v3.1 (2026-05-04 사용자 1차 검증 후속) ───

    def test_v3_1_single_subject_omits_prefix(self) -> None:
        """단일 인물은 'subject 1:' prefix 생략 (자연스러운 카드 표시)."""
        observation = {
            "subjects": [
                {
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "woman",
                    "face_direction": "forward",
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        assert "subject 1:" not in slots["subject"]
        assert "young adult woman" in slots["subject"]
        assert "face: forward" in slots["subject"]

    def test_v3_1_multi_subject_keeps_prefix(self) -> None:
        """다중 인물은 'subject 1:' / 'subject 2:' prefix 유지 (구분 필수)."""
        observation = {
            "subjects": [
                {"apparent_age_group": "young adult", "broad_visible_appearance": "woman"},
                {"apparent_age_group": "middle-aged", "broad_visible_appearance": "man"},
            ]
        }
        slots = map_observation_to_slots(observation)
        assert "subject 1:" in slots["subject"]
        assert "subject 2:" in slots["subject"]
        assert "young adult woman" in slots["subject"]
        assert "middle-aged man" in slots["subject"]

    def test_v3_1_environment_sub_label_prefix(self) -> None:
        """환경 카드도 sub-label 도입 (location/scene/weather/crowd)."""
        observation = {
            "environment": {
                "location_type": "outdoor music festival",
                "background": ["stage", "MUSIC sign"],
                "weather_or_surface_condition": ["rain", "wet surfaces"],
                "crowd_detail": {
                    "people_visible": "dozens",
                },
            }
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        assert "location: outdoor music festival" in env
        assert "scene: stage, MUSIC sign" in env
        assert "weather: rain, wet surfaces" in env
        assert "crowd: dozens" in env

    def test_v3_1_environment_strips_interaction_object(self) -> None:
        """env.foreground/midground/background 안 object_interaction.object (cup) 누수 제거."""
        observation = {
            "subjects": [
                {
                    "object_interaction": {
                        "object": "plastic cup",
                        "action": "drinking",
                    }
                }
            ],
            "environment": {
                "location_type": "festival",
                "foreground": ["plastic cup", "wet ground"],
                "midground": ["crowd of people", "another plastic cup"],
                "background": ["stage"],
            },
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        # "plastic cup" 환경에서 모두 사라짐 (foreground + midground 둘 다)
        assert "plastic cup" not in env
        assert "another plastic cup" not in env
        # 다른 항목은 보존
        assert "wet ground" in env
        assert "crowd of people" in env
        assert "stage" in env

    def test_v3_1_environment_dedups_rainwear_within_foreground(self) -> None:
        """foreground 안 RAINWEAR 항목 여러 개면 1개만 유지 (transparent ponchos + rain ponchos 중복 차단)."""
        observation = {
            "environment": {
                "foreground": ["transparent plastic ponchos", "rain ponchos", "wet ground"],
            }
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        # ponchos 단어가 1번만 등장 (둘 중 첫 번째 만 유지)
        assert env.count("ponchos") == 1
        assert "transparent plastic ponchos" in env
        assert "rain ponchos" not in env
        # 다른 항목은 보존
        assert "wet ground" in env

    def test_v3_1_environment_crowd_dedup_with_self_dedup(self) -> None:
        """crowd_detail 이 rainwear 잡으면 + foreground 자체 dedup 합쳐서 raincoats 1번만."""
        observation = {
            "environment": {
                "foreground": ["transparent ponchos", "plastic raincoats"],
                "crowd_detail": {
                    "raincoats_or_ponchos": "yes",  # → "raincoats visible"
                },
            }
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        # crowd 가 rainwear 잡았으니 foreground 의 모든 rainwear 제거
        assert "transparent ponchos" not in env
        assert "plastic raincoats" not in env
        # crowd 라벨로 1번만 노출
        assert "raincoats visible" in env

    # ─── v3.2 (사용자 2차 검증 후속 + Codex 리뷰) ───

    def test_v3_2_environment_drops_subject_word_from_scene(self) -> None:
        """env.foreground/midground/background 에 단독 'subject'/'subjects' 단어 누수 차단."""
        observation = {
            "environment": {
                "foreground": ["subject", "neon lights"],
                "midground": ["Subjects", "stage lights"],
                "background": ["sky"],
            }
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        assert "scene:" in env
        # 'subject' / 'Subjects' 단독 drop
        assert "subject" not in env.lower().replace("subjects", "")  # subjects 도 같이 제거됐는지
        # 다른 항목 보존
        assert "neon lights" in env
        assert "stage lights" in env
        assert "sky" in env

    def test_v3_2_crowd_self_dedup_rainwear_synonyms(self) -> None:
        """crowd 안 raincoats_or_ponchos + crowd_clothing 동의어 중복 차단."""
        observation = {
            "environment": {
                "crowd_detail": {
                    "raincoats_or_ponchos": "transparent raincoats",
                    "crowd_clothing": ["rain ponchos", "wet hair"],
                    "people_visible": "a few",
                },
            }
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        # raincoats 카테고리 1번만 (transparent raincoats 만 남고 rain ponchos 제거)
        assert "transparent raincoats" in env
        assert "rain ponchos" not in env
        # crowd_clothing 의 비-rainwear 항목은 보존
        assert "wet hair" in env
        assert "a few" in env

    # ─── v3.3 hotfix (사용자 4 케이스 검증 후속) ───

    def test_v3_3_clothing_boolean_yes_is_labelized(self) -> None:
        """clothing_detail.cutouts_or_openings='yes' → 'with cutouts' 라벨링 / strap_layout='yes' → drop."""
        observation = {
            "subjects": [
                {
                    "clothing_detail": {
                        "top_color": "gray",
                        "strap_layout": "yes",         # 의미 모호 → drop
                        "cutouts_or_openings": "yes",  # → "with cutouts" 라벨
                        "top_type": "crop top",
                    }
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        clothing = slots["clothing_or_materials"].lower()
        # "yes" 단독 단어가 carded 안에 노출되면 안 됨
        assert " yes " not in f" {clothing} "
        # cutouts 라벨링은 살아남
        assert "with cutouts" in clothing
        # 정상 데이터는 보존
        assert "gray" in clothing
        assert "crop top" in clothing

    def test_v3_3_clothing_strap_layout_string_is_preserved(self) -> None:
        """strap_layout 이 정상 string ('single shoulder strap') 이면 그대로 보존."""
        observation = {
            "subjects": [
                {
                    "clothing_detail": {
                        "top_color": "gray",
                        "strap_layout": "single shoulder strap",  # 정상 — 보존
                        "top_type": "crop top",
                    }
                }
            ]
        }
        slots = map_observation_to_slots(observation)
        clothing = slots["clothing_or_materials"].lower()
        assert "single shoulder strap" in clothing
        assert "gray" in clothing
        assert "crop top" in clothing

    def test_v3_3_crowd_focus_subject_reference_is_dropped(self) -> None:
        """crowd_focus='on the subject' 같은 subject 참조 표현은 carded 에서 drop (대소문자/공백 정규화)."""
        observation = {
            "environment": {
                "crowd_detail": {
                    "raincoats_or_ponchos": "transparent rain ponchos",
                    "crowd_focus": "on the subject",  # → drop
                    "people_visible": "a few",
                },
            }
        }
        slots = map_observation_to_slots(observation)
        env_low = slots["environment"].lower()
        # subject 참조 표현 사라짐
        assert "on the subject" not in env_low
        assert "the subject" not in env_low
        # 정상 정보는 살아남
        assert "transparent rain ponchos" in env_low
        assert "a few" in env_low

    def test_v3_3_crowd_focus_subject_reference_normalized_variants(self) -> None:
        """대소문자/공백 변형도 정규화 매칭으로 drop ('On The Subjects', 'on  subject ' 등)."""
        for variant in ["On The Subject", "on  subject ", "  Subjects", "Focused On Subject"]:
            observation = {
                "environment": {
                    "crowd_detail": {
                        "crowd_focus": variant,
                        "people_visible": "a few",
                    },
                }
            }
            slots = map_observation_to_slots(observation)
            env_low = slots["environment"].lower()
            assert "subject" not in env_low, f"variant '{variant}' 가 정규화 매칭으로 drop 안 됨: '{env_low}'"
            assert "a few" in env_low

    def test_v3_3_crowd_focus_descriptive_phrase_preserved(self) -> None:
        """crowd_focus 가 의미 있는 phrase ('looking at stage') 면 보존."""
        observation = {
            "environment": {
                "crowd_detail": {
                    "crowd_focus": "looking at stage",
                    "people_visible": "a few",
                },
            }
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        assert "looking at stage" in env
        assert "a few" in env

    def test_v3_2_crowd_join_order_people_first(self) -> None:
        """crowd: 안 join 순서 — people_phrase 먼저 (자연 어순)."""
        observation = {
            "environment": {
                "crowd_detail": {
                    "raincoats_or_ponchos": "yes",  # → "raincoats visible"
                    "people_visible": "a few",
                },
            }
        }
        slots = map_observation_to_slots(observation)
        env = slots["environment"]
        # crowd: 안에서 'a few' 가 'raincoats visible' 보다 앞에 와야 함
        crowd_section = env.split("crowd:")[1] if "crowd:" in env else ""
        a_few_idx = crowd_section.find("a few")
        rain_idx = crowd_section.find("raincoats visible")
        assert a_few_idx >= 0
        assert rain_idx >= 0
        assert a_few_idx < rain_idx, f"people_phrase 가 rain_phrase 보다 앞에 와야 함: '{crowd_section}'"

    def test_v3_yes_no_formatter_for_crowd_detail(self) -> None:
        """raincoats_or_ponchos='yes' → 'raincoats visible' / 'no' → 빈 문자열 / descriptor → 원문."""
        # yes → 라벨 표시
        slots_yes = map_observation_to_slots({
            "environment": {
                "crowd_detail": {"raincoats_or_ponchos": "yes", "people_visible": "yes"},
            }
        })
        assert "raincoats visible" in slots_yes["environment"]
        assert "people visible" in slots_yes["environment"]

        # no → 빈 문자열
        slots_no = map_observation_to_slots({
            "environment": {
                "crowd_detail": {"raincoats_or_ponchos": "no", "people_visible": "no"},
            }
        })
        assert "raincoats visible" not in slots_no["environment"]
        assert "people visible" not in slots_no["environment"]
        # boolean leak ("yes"/"no" 단어 자체) 도 차단
        assert "yes" not in slots_no["environment"]
        assert "no," not in slots_no["environment"]
