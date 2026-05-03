# backend/studio/vision_pipeline/observation_mapping.py
"""
observation_mapping — vision observation JSON → 9 슬롯 5개 매핑 (2026-05-03).

text model (prompt_synthesize) 가 안 채우는 5 슬롯을 observation JSON 에서
직접 매핑. frontend RecipeV2View 의 6 디테일 카드 호환 유지.

매핑 대상: composition, subject, clothing_or_materials, environment,
          lighting_camera_style

Phase 3 (Recall): face_detail / object_interaction / clothing_detail /
crowd_detail 새 슬롯 흡수 완료.
매핑 우선순위: 새 슬롯 채워지면 우선 / 비어있으면 옛 슬롯 fallback.
"""

from __future__ import annotations

from typing import Any


def _join_nonempty(items: list[Any] | tuple[Any, ...], sep: str = ", ") -> str:
    """None / 빈 문자열 제외 후 join. 항상 string 반환."""
    parts = [str(x).strip() for x in items if x and str(x).strip()]
    return sep.join(parts)


def _format_subject(s: dict[str, Any], idx: int) -> str:
    """단일 subject dict → 사람이 읽을 수 있는 문장.

    face_detail 새 슬롯 (Phase 1) 이 채워졌으면 우선 사용,
    비어있으면 옛 expression/eyes/mouth fallback (backward compat).
    """
    label_parts = [
        s.get("apparent_age_group"),
        s.get("broad_visible_appearance"),
    ]

    # face_detail 새 슬롯 (우선)
    face_detail = s.get("face_detail") if isinstance(s.get("face_detail"), dict) else {}
    eye_state = face_detail.get("eye_state") or ""
    mouth_state = face_detail.get("mouth_state") or ""
    expression_notes = face_detail.get("expression_notes") or []

    # 옛 슬롯 fallback
    eyes_old = s.get("eyes") or ""
    mouth_old = s.get("mouth") or ""
    expression_old = s.get("expression") or ""

    detail_parts = [
        s.get("face_direction"),
        # face_detail 우선, 없으면 옛 expression
        eye_state or expression_old,
        mouth_state or mouth_old,
        eyes_old if not eye_state else "",
        s.get("hair"),
        s.get("pose"),
        s.get("hands"),
        _join_nonempty(expression_notes, sep=" / "),
    ]
    head = _join_nonempty(label_parts, sep=" ")
    detail = _join_nonempty(detail_parts, sep=", ")
    if head and detail:
        return f"subject {idx}: {head} — {detail}"
    if head:
        return f"subject {idx}: {head}"
    if detail:
        return f"subject {idx}: {detail}"
    return ""


def _format_clothing(subjects: list[dict[str, Any]]) -> str:
    """clothing_or_materials 슬롯 — clothing_detail 새 슬롯 우선 + object_interaction
    + 옛 clothing[]/accessories_or_objects[] fallback.

    새 슬롯 (clothing_detail.top_*, bottom_*) 가 채워졌으면 그것 사용.
    object_interaction.object 가 있으면 추가 (cup raised to lips 등 보존).
    새 슬롯 둘 다 비어있으면 옛 clothing[] 사용 (backward compat).
    """
    parts: list[str] = []
    for s in subjects:
        if not isinstance(s, dict):
            continue

        # clothing_detail 새 슬롯 (우선)
        cd = s.get("clothing_detail") if isinstance(s.get("clothing_detail"), dict) else {}
        top_phrases = _join_nonempty([
            cd.get("top_color"),
            cd.get("strap_layout"),
            cd.get("cutouts_or_openings"),
            cd.get("top_type"),
        ], sep=" ")
        bottom_phrases = _join_nonempty([
            cd.get("bottom_color"),
            cd.get("bottom_type"),
            _join_nonempty(cd.get("bottom_style_details") or [], sep=" "),
        ], sep=" ")

        if top_phrases:
            parts.append(top_phrases)
        if bottom_phrases:
            parts.append(bottom_phrases)

        # object_interaction (cup raised to lips 같은 동작 보존)
        oi = s.get("object_interaction") if isinstance(s.get("object_interaction"), dict) else {}
        oi_obj = oi.get("object") or ""
        oi_pos = oi.get("object_position_relative_to_face") or ""
        oi_act = oi.get("action") or ""
        if oi_obj:
            oi_phrase = _join_nonempty([oi_obj, oi_pos, oi_act], sep=", ")
            parts.append(oi_phrase)

        # 옛 슬롯 fallback (clothing_detail 비어있으면 옛 clothing[] 사용)
        if not top_phrases and not bottom_phrases:
            old_clothing = s.get("clothing") or []
            if isinstance(old_clothing, list):
                parts.extend(old_clothing)

        # accessories_or_objects 는 object_interaction 없을 때만 추가
        if not oi_obj:
            accessories = s.get("accessories_or_objects") or []
            if isinstance(accessories, list):
                parts.extend(accessories)

    return _join_nonempty(parts)


def map_observation_to_slots(observation: dict[str, Any]) -> dict[str, str]:
    """observation JSON → 5 슬롯 (composition / subject / clothing_or_materials / environment / lighting_camera_style)."""
    if not observation:
        return {
            "composition": "",
            "subject": "",
            "clothing_or_materials": "",
            "environment": "",
            "lighting_camera_style": "",
        }

    # composition: framing 합본
    framing = observation.get("framing", {}) or {}
    orientation = observation.get("image_orientation", "") or ""
    composition = _join_nonempty([
        orientation,
        framing.get("crop"),
        framing.get("camera_angle"),
        framing.get("subject_position"),
    ])

    # subject: subjects 배열 → 다중 처리 (None / non-dict 항목 skip)
    subjects = observation.get("subjects", []) or []
    subject = "; ".join(filter(None, [
        _format_subject(s, i + 1) for i, s in enumerate(subjects) if isinstance(s, dict)
    ]))

    # clothing_or_materials: clothing_detail 우선 + object_interaction + 옛 fallback
    clothing_or_materials = _format_clothing(subjects)

    # environment: location + foreground/middle/background + weather + crowd_detail
    env = observation.get("environment", {}) or {}
    crowd = env.get("crowd_detail") if isinstance(env.get("crowd_detail"), dict) else {}
    crowd_phrase = _join_nonempty([
        crowd.get("raincoats_or_ponchos"),  # "transparent raincoats" 등
        _join_nonempty(crowd.get("crowd_clothing") or [], sep=" "),
        crowd.get("crowd_focus"),
        crowd.get("people_visible"),
    ])
    environment = _join_nonempty([
        env.get("location_type"),
        _join_nonempty(env.get("foreground", []) or []),
        _join_nonempty(env.get("midground", []) or []),
        _join_nonempty(env.get("background", []) or []),
        _join_nonempty(env.get("weather_or_surface_condition", []) or []),
        crowd_phrase,
    ])

    # lighting_camera_style: lighting + photo_quality 합본
    light = observation.get("lighting_and_color", {}) or {}
    photo = observation.get("photo_quality", {}) or {}
    lighting_camera_style = _join_nonempty([
        _join_nonempty(light.get("visible_light_sources", []) or []),
        _join_nonempty(light.get("dominant_colors", []) or []),
        light.get("contrast"),
        photo.get("depth_of_field"),
        photo.get("focus_target"),
        _join_nonempty(photo.get("style_evidence", []) or []),
    ])

    return {
        "composition": composition,
        "subject": subject,
        "clothing_or_materials": clothing_or_materials,
        "environment": environment,
        "lighting_camera_style": lighting_camera_style,
    }
