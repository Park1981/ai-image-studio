# backend/studio/vision_pipeline/observation_mapping.py
"""
observation_mapping — vision observation JSON → 9 슬롯 5개 매핑.

text model (prompt_synthesize) 가 안 채우는 5 슬롯을 observation JSON 에서
직접 매핑. frontend RecipeV2View 의 6 디테일 카드 호환 유지.

매핑 대상: composition, subject, clothing_or_materials, environment,
          lighting_camera_style

Phase 3 (Recall · 2026-05-03): face_detail / object_interaction /
clothing_detail / crowd_detail 새 슬롯 흡수.

v3 fix (2026-05-04 · Codex 2차 리뷰 반영):
  - 라벨 없는 join 의 sentinel filter (none/null/n/a/na/unknown/
    unspecified/not specified/not visible/not applicable) 만 차단.
    yes/no/true/false/subject 는 라벨 prefix 가 붙으면 의미가 살아남
    → 필드별 _format_yes_no helper 또는 라벨 분기로 처리.
  - 모든 카드에 sub-label prefix 도입 (face/eyes/mouth/expression/hair/
    pose/hands/interaction · top/bottom/accessories · lights/colors/
    contrast/dof/focus/style · orientation/crop/angle/position).
  - object_interaction 은 의상 → 피사체 카드로 이동 (interaction: 라벨).
  - accessories 에서 object_interaction.object 중복 제거.
  - environment.foreground 의 raincoat-related 항목은 crowd_detail 에
    잡혔을 때 dedup (RAINWEAR_KEYWORDS 9개 substring).
  - _format_subject 의 eye_state OR expression_old 차원 혼합 오설계 fix.
"""

from __future__ import annotations

import re
from typing import Any


# 의미 없는 placeholder 만 — yes/no/true/false/subject 는 제외
# (formatter 가 라벨 붙이면 살아나는 값들이라 전역 차단 X)
SENTINEL_VALUES = frozenset({
    "none",
    "null",
    "n/a",
    "na",
    "unknown",
    "unspecified",
    "not specified",
    "not visible",
    "not applicable",
})

# crowd_focus 등에 자주 누수되는 짧은 subject 참조 표현 — 카드에서 의미 없으니 drop
SUBJECT_REFERENCE_PHRASES = frozenset({
    "subject",
    "subjects",
    "the subject",
    "the subjects",
    "on subject",
    "on subjects",
    "on the subject",
    "on the subjects",
    "focused on subject",
    "focused on the subject",
    "focused on the subjects",
})

# raincoats 카테고리 dedup 용 키워드 (env.foreground vs crowd_detail 중복 방지)
RAINWEAR_KEYWORDS: tuple[str, ...] = (
    "raincoat",
    "raincoats",
    "poncho",
    "ponchos",
    "plastic rainwear",
    "transparent rainwear",
    "clear poncho",
    "rain coat",
    "rain coats",
)


def _norm(value: Any) -> str:
    """대소문자/공백 흔들림 정규화 — SUBJECT_REFERENCE_PHRASES 매칭용."""
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _join_nonempty(items: list[Any] | tuple[Any, ...], sep: str = ", ") -> str:
    """None / 빈 문자열 / sentinel placeholder 제외 후 join. 항상 string 반환.

    sentinel: SENTINEL_VALUES 에 등록된 placeholder 만 차단 (대소문자 무시).
    yes/no/true/false 같은 값은 통과 — 라벨 prefix 없이 노출되는 곳에서
    의미가 안 사는 건 사실이지만, 의미 분기는 필드별 formatter 가 책임.
    """
    parts: list[str] = []
    for x in items:
        if not x:
            continue
        s = str(x).strip()
        if not s or s.lower() in SENTINEL_VALUES:
            continue
        parts.append(s)
    return sep.join(parts)


def _format_yes_no(yes_label: str, value: Any) -> str:
    """필드별 boolean 처리 — yes/true → yes_label / no/false → "" / 그 외 → 원문 보존.

    예: _format_yes_no("raincoats visible", "yes") == "raincoats visible"
        _format_yes_no("people visible", "dense crowd") == "dense crowd"
        _format_yes_no("raincoats visible", "no") == ""
    """
    v = str(value or "").strip()
    if not v:
        return ""
    low = v.lower()
    if low in {"yes", "true"}:
        return yes_label
    if low in {"no", "false"}:
        return ""
    if low in SENTINEL_VALUES:
        return ""
    return v


def _has_rainwear(text: str) -> bool:
    """text 안에 RAINWEAR_KEYWORDS 중 하나라도 포함됐는지 (대소문자 무시)."""
    if not text:
        return False
    low = text.lower()
    return any(kw in low for kw in RAINWEAR_KEYWORDS)


def _format_object_interaction(s: dict[str, Any]) -> str:
    """object_interaction (cup raised to lips, drinking 등) → 1줄 문장."""
    oi = s.get("object_interaction") if isinstance(s.get("object_interaction"), dict) else {}
    if not oi:
        return ""
    return _join_nonempty([
        oi.get("object"),
        oi.get("object_position_relative_to_face"),
        oi.get("action"),
    ], sep=", ")


def _format_subject(s: dict[str, Any]) -> str:
    """단일 subject dict → 사람이 읽을 수 있는 sub-label 문장 (prefix 없이).

    구조: {head} — {label}: {val} · {label}: {val} · ...
      head: apparent_age_group + broad_visible_appearance
      detail labels: face / eyes / mouth / expression / hair / pose / hands / interaction

    'subject N:' prefix 는 호출 site (map_observation_to_slots) 가 다중일 때만
    덧붙임 — 단일 인물 카드에서 prefix 가 어색해지는 걸 방지.
    """
    label_parts = [
        s.get("apparent_age_group"),
        s.get("broad_visible_appearance"),
    ]

    # face_detail 새 슬롯 (Phase 3 Recall · 우선)
    face_detail = s.get("face_detail") if isinstance(s.get("face_detail"), dict) else {}
    eye_state = (face_detail.get("eye_state") or "").strip()
    mouth_state = (face_detail.get("mouth_state") or "").strip()
    expression_notes_raw = face_detail.get("expression_notes") or []
    expression_notes = expression_notes_raw if isinstance(expression_notes_raw, list) else []

    # 옛 슬롯 (face_detail 비어있으면 fallback · backward compat)
    eyes_old = (s.get("eyes") or "").strip()
    mouth_old = (s.get("mouth") or "").strip()
    expression_old = (s.get("expression") or "").strip()

    # 차원별 분리 (v3 fix · OR 오설계 제거)
    eyes_value = eye_state or eyes_old
    mouth_value = mouth_state or mouth_old
    expression_value = _join_nonempty(
        [expression_old, *[str(x) for x in expression_notes]],
        sep=" / ",
    )

    interaction_value = _format_object_interaction(s)

    labeled: list[tuple[str, str]] = [
        ("face", str(s.get("face_direction") or "").strip()),
        ("eyes", eyes_value),
        ("mouth", mouth_value),
        ("expression", expression_value),
        ("hair", str(s.get("hair") or "").strip()),
        ("pose", str(s.get("pose") or "").strip()),
        ("hands", str(s.get("hands") or "").strip()),
        ("interaction", interaction_value),
    ]

    head = _join_nonempty(label_parts, sep=" ")
    detail_pairs = [(lbl, val) for lbl, val in labeled if val and val.lower() not in SENTINEL_VALUES]
    detail = " · ".join(f"{lbl}: {val}" for lbl, val in detail_pairs)

    if head and detail:
        return f"{head} — {detail}"
    if head:
        return head
    if detail:
        return detail
    return ""


def _format_clothing(subjects: list[dict[str, Any]]) -> str:
    """clothing_or_materials 슬롯 — clothing_detail 새 슬롯 + 옛 fallback + sub-label.

    구조: top: ... · bottom: ... · accessories: ...
    object_interaction 은 _format_subject 의 interaction: 라벨로 이동 (의상 카드에 X).
    accessories 에서 object_interaction.object 와 중복되는 항목 (대소문자 무시 substring) 은 제거.
    """
    parts: list[str] = []
    for s in subjects:
        if not isinstance(s, dict):
            continue

        # clothing_detail 새 슬롯 (우선)
        # boolean-prone 필드 (cutouts_or_openings, strap_layout) 는 _format_yes_no 처리:
        #   - cutouts_or_openings="yes" → "with cutouts" 라벨 / "side cutouts" → 원문 보존
        #   - strap_layout="yes" → drop (정보 모호) / "single shoulder strap" → 원문 보존
        cd = s.get("clothing_detail") if isinstance(s.get("clothing_detail"), dict) else {}
        top_phrases = _join_nonempty([
            cd.get("top_color"),
            _format_yes_no("", cd.get("strap_layout")),  # yes/no 단독 → drop
            _format_yes_no("with cutouts", cd.get("cutouts_or_openings")),
            cd.get("top_type"),
        ], sep=" ")
        bottom_phrases = _join_nonempty([
            cd.get("bottom_color"),
            cd.get("bottom_type"),
            _join_nonempty(cd.get("bottom_style_details") or [], sep=" "),
        ], sep=" ")

        # 옛 슬롯 fallback (clothing_detail 비어있으면 옛 clothing[] 으로 top 만 채움)
        if not top_phrases and not bottom_phrases:
            old_clothing = s.get("clothing") or []
            if isinstance(old_clothing, list):
                top_phrases = _join_nonempty(old_clothing, sep=", ")

        # accessories 에서 object_interaction.object 중복 제거 (v3)
        oi_obj = (s.get("object_interaction") or {}).get("object") if isinstance(s.get("object_interaction"), dict) else ""
        oi_obj_low = str(oi_obj or "").strip().lower()
        raw_accessories = s.get("accessories_or_objects") or []
        if isinstance(raw_accessories, list):
            if oi_obj_low:
                filtered_accessories = [
                    a for a in raw_accessories
                    if not (isinstance(a, str) and oi_obj_low and oi_obj_low in a.lower())
                ]
            else:
                filtered_accessories = list(raw_accessories)
            accessories = _join_nonempty(filtered_accessories)
        else:
            accessories = ""

        subject_labeled: list[tuple[str, str]] = [
            ("top", top_phrases),
            ("bottom", bottom_phrases),
            ("accessories", accessories),
        ]
        for lbl, val in subject_labeled:
            if val:
                parts.append(f"{lbl}: {val}")

    return " · ".join(parts)


def _collect_interaction_objects(subjects: list[Any]) -> list[str]:
    """모든 subject 의 object_interaction.object 들을 수집 (소문자 strip)."""
    objs: list[str] = []
    for s in subjects:
        if not isinstance(s, dict):
            continue
        oi = s.get("object_interaction") if isinstance(s.get("object_interaction"), dict) else {}
        obj = str(oi.get("object") or "").strip().lower()
        if obj:
            objs.append(obj)
    return objs


def _strip_interaction_objects(items: list[Any], interaction_objs: list[str]) -> list[Any]:
    """environment 안 항목에서 object_interaction.object 와 substring 일치하는 것 제거."""
    if not interaction_objs:
        return list(items)
    return [
        x for x in items
        if not (isinstance(x, str) and any(io in x.lower() for io in interaction_objs))
    ]


def _dedup_rainwear(items: list[Any]) -> list[Any]:
    """동일 리스트 안 RAINWEAR 항목 여러 개면 1개만 유지 (transparent ponchos / rain ponchos 같은 중복 차단)."""
    seen = False
    result: list[Any] = []
    for x in items:
        if isinstance(x, str) and _has_rainwear(x):
            if seen:
                continue
            seen = True
        result.append(x)
    return result


def _drop_subject_word(items: list[Any]) -> list[Any]:
    """단독 'subject'/'subjects' 단어를 environment scene 리스트에서 제거 (모델 leak 차단).

    lighting 카드의 focus_target 처리 패턴 재사용 — '환경' 카테고리에 'subject'
    단어 단독으로 들어오는 건 의미 없는 누수.
    """
    return [
        x for x in items
        if not (isinstance(x, str) and x.strip().lower() in {"subject", "subjects"})
    ]


def _format_environment(observation: dict[str, Any]) -> str:
    """environment 슬롯 — sub-label (location/scene/weather/crowd) + dedup 강화.

    구조: location: ... · scene: ... · weather: ... · crowd: ...
      scene: foreground + midground + background 합본 (object_interaction.object 누수 제거 + RAINWEAR 자체 dedup)
      weather: weather_or_surface_condition
      crowd: crowd_detail 의 raincoats/clothing/focus/people_visible (boolean 은 _format_yes_no 라벨링)
    """
    env = observation.get("environment", {}) or {}
    crowd = env.get("crowd_detail") if isinstance(env.get("crowd_detail"), dict) else {}
    subjects = observation.get("subjects", []) or []
    interaction_objs = _collect_interaction_objects(subjects)

    # crowd 의 boolean 류 → 라벨링 (yes → "raincoats visible" 등)
    rain_phrase = _format_yes_no("raincoats visible", crowd.get("raincoats_or_ponchos"))
    people_phrase = _format_yes_no("people visible", crowd.get("people_visible"))

    crowd_clothing_raw = crowd.get("crowd_clothing") if isinstance(crowd.get("crowd_clothing"), list) else []

    # crowd 안 RAINWEAR self-dedup — raincoats_or_ponchos 가 RAINWEAR 잡았으면
    # crowd_clothing 의 RAINWEAR 항목 제거 (transparent raincoats vs rain ponchos 동의어 중복 차단)
    crowd_clothing_items = list(crowd_clothing_raw)
    if rain_phrase and _has_rainwear(rain_phrase):
        crowd_clothing_items = [
            x for x in crowd_clothing_items
            if not (isinstance(x, str) and _has_rainwear(x))
        ]
    # crowd_clothing 자체에서도 RAINWEAR 여러 개면 1개만 (안전망)
    crowd_clothing_items = _dedup_rainwear(crowd_clothing_items)
    crowd_clothing_phrase = _join_nonempty(crowd_clothing_items, sep=" ")

    # crowd_focus — sentinel + subject reference (on the subject 등) 정규화 매칭으로 drop
    crowd_focus_phrase = str(crowd.get("crowd_focus") or "").strip()
    norm_focus = _norm(crowd_focus_phrase)
    if norm_focus in SENTINEL_VALUES or norm_focus in SUBJECT_REFERENCE_PHRASES:
        crowd_focus_phrase = ""

    # 자연 어순: people 먼저 → rain → 나머지
    crowd_phrase = _join_nonempty([
        people_phrase,
        rain_phrase,
        crowd_clothing_phrase,
        crowd_focus_phrase,
    ])

    # foreground/midground/background — interaction object 누수 제거 + RAINWEAR 자체 dedup + "subject" 단독 drop
    def _clean_scene_list(raw: Any) -> list[Any]:
        if not isinstance(raw, list):
            return []
        cleaned = _strip_interaction_objects(raw, interaction_objs)
        cleaned = _dedup_rainwear(cleaned)
        cleaned = _drop_subject_word(cleaned)
        return cleaned

    foreground_items = _clean_scene_list(env.get("foreground"))
    # crowd 가 rainwear 잡았으면 foreground 의 rainwear 도 제거 (이중 안전망)
    if rain_phrase and _has_rainwear(rain_phrase):
        foreground_items = [
            x for x in foreground_items
            if not (isinstance(x, str) and _has_rainwear(x))
        ]
    midground_items = _clean_scene_list(env.get("midground"))
    background_items = _clean_scene_list(env.get("background"))

    scene_phrase = _join_nonempty([
        _join_nonempty(foreground_items),
        _join_nonempty(midground_items),
        _join_nonempty(background_items),
    ])

    weather_phrase = _join_nonempty(env.get("weather_or_surface_condition", []) or [])

    labeled_e: list[tuple[str, str]] = [
        ("location", str(env.get("location_type") or "").strip()),
        ("scene", scene_phrase),
        ("weather", weather_phrase),
        ("crowd", crowd_phrase),
    ]
    pairs = [(lbl, val) for lbl, val in labeled_e if val and val.lower() not in SENTINEL_VALUES]
    return " · ".join(f"{lbl}: {val}" for lbl, val in pairs)


def _format_lighting_camera(observation: dict[str, Any]) -> str:
    """lighting_camera_style — sub-label prefix (lights/colors/contrast/dof/focus/style).

    contrast=high / dof=shallow 는 sentinel 아님 (라벨 prefix 가 의미 보장).
    focus_target="subject" (단독) 은 너무 기본값이라 drop.
    style_evidence=["none"] 은 _join_nonempty 가 자동 drop.
    """
    light = observation.get("lighting_and_color", {}) or {}
    photo = observation.get("photo_quality", {}) or {}

    lights_phrase = _join_nonempty(light.get("visible_light_sources", []) or [])
    colors_phrase = _join_nonempty(light.get("dominant_colors", []) or [])
    contrast_phrase = str(light.get("contrast") or "").strip()
    dof_phrase = str(photo.get("depth_of_field") or "").strip()

    focus_raw = str(photo.get("focus_target") or "").strip()
    # 단독 "subject"/"subjects" 는 drop (구체 표현은 보존)
    if focus_raw.lower() in {"subject", "subjects"}:
        focus_phrase = ""
    else:
        focus_phrase = focus_raw

    style_phrase = _join_nonempty(photo.get("style_evidence", []) or [])

    labeled_l: list[tuple[str, str]] = [
        ("lights", lights_phrase),
        ("colors", colors_phrase),
        ("contrast", contrast_phrase),
        ("dof", dof_phrase),
        ("focus", focus_phrase),
        ("style", style_phrase),
    ]
    pairs = [(lbl, val) for lbl, val in labeled_l if val and val.lower() not in SENTINEL_VALUES]
    return " · ".join(f"{lbl}: {val}" for lbl, val in pairs)


def _format_composition(observation: dict[str, Any]) -> str:
    """composition — sub-label prefix (orientation/crop/angle/position)."""
    framing = observation.get("framing", {}) or {}
    orientation = str(observation.get("image_orientation") or "").strip()
    labeled_c: list[tuple[str, str]] = [
        ("orientation", orientation),
        ("crop", str(framing.get("crop") or "").strip()),
        ("angle", str(framing.get("camera_angle") or "").strip()),
        ("position", str(framing.get("subject_position") or "").strip()),
    ]
    pairs = [(lbl, val) for lbl, val in labeled_c if val and val.lower() not in SENTINEL_VALUES]
    return " · ".join(f"{lbl}: {val}" for lbl, val in pairs)


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

    composition = _format_composition(observation)

    subjects = observation.get("subjects", []) or []
    # dict 항목만 추출 후 format — None / 비-dict 은 skip
    valid_subjects = [s for s in subjects if isinstance(s, dict)]
    subject_strs = [s for s in (_format_subject(s) for s in valid_subjects) if s]
    if len(subject_strs) == 0:
        subject = ""
    elif len(subject_strs) == 1:
        # 단일 인물은 'subject 1:' prefix 생략 — 카드에서 자연스럽게 읽힘
        subject = subject_strs[0]
    else:
        # 다중 인물만 prefix 부여 (구분 필요)
        subject = "; ".join(f"subject {i + 1}: {x}" for i, x in enumerate(subject_strs))

    clothing_or_materials = _format_clothing(valid_subjects)
    environment = _format_environment(observation)
    lighting_camera_style = _format_lighting_camera(observation)

    return {
        "composition": composition,
        "subject": subject,
        "clothing_or_materials": clothing_or_materials,
        "environment": environment,
        "lighting_camera_style": lighting_camera_style,
    }
