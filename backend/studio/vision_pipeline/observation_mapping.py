# backend/studio/vision_pipeline/observation_mapping.py
"""
observation_mapping — vision observation JSON → 9 슬롯 5개 매핑 (2026-05-03).

text model (prompt_synthesize) 가 안 채우는 5 슬롯을 observation JSON 에서
직접 매핑. frontend RecipeV2View 의 6 디테일 카드 호환 유지.

매핑 대상: composition, subject, clothing_or_materials, environment,
          lighting_camera_style
"""

from __future__ import annotations

from typing import Any


def _join_nonempty(items: list[Any] | tuple[Any, ...], sep: str = ", ") -> str:
    """None / 빈 문자열 제외 후 join. 항상 string 반환."""
    parts = [str(x).strip() for x in items if x and str(x).strip()]
    return sep.join(parts)


def _format_subject(s: dict[str, Any], idx: int) -> str:
    """단일 subject dict → 사람이 읽을 수 있는 문장."""
    label_parts = [
        s.get("apparent_age_group"),
        s.get("broad_visible_appearance"),
    ]
    detail_parts = [
        s.get("face_direction"),
        s.get("expression"),
        s.get("eyes"),
        s.get("mouth"),
        s.get("hair"),
        s.get("pose"),
        s.get("hands"),
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

    # clothing_or_materials: 모든 subject 의 clothing + accessories 합본
    # str 로 오는 경우 character-iterate 방지 → isinstance(list) 체크
    clothing_items: list[str] = []
    for s in subjects:
        if not isinstance(s, dict):
            continue
        clothing_raw = s.get("clothing") or []
        if isinstance(clothing_raw, list):
            clothing_items.extend(clothing_raw)
        accessories_raw = s.get("accessories_or_objects") or []
        if isinstance(accessories_raw, list):
            clothing_items.extend(accessories_raw)
    clothing_or_materials = _join_nonempty(clothing_items)

    # environment: location + foreground/middle/background + weather
    env = observation.get("environment", {}) or {}
    environment = _join_nonempty([
        env.get("location_type"),
        _join_nonempty(env.get("foreground", []) or []),
        _join_nonempty(env.get("midground", []) or []),
        _join_nonempty(env.get("background", []) or []),
        _join_nonempty(env.get("weather_or_surface_condition", []) or []),
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
