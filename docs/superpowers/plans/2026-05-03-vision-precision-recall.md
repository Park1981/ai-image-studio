# Vision Precision Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2-stage 분업 architecture (이미 master 머지됨 · `40f183e`) 의 5차 검증에서 발견된 **정밀 복원 약점** (윙크 / cutout / cargo / 우비 / chest-up 누락) 해결.

**Architecture:** 2-stage 구조 그대로 유지. 변경:
1. **Vision schema 확장** — `face_detail` / `object_interaction` / `clothing_detail` / `crowd_detail` 새 슬롯 (모델한테 "자세히 봐" 보다 "자세히 볼 칸 만들어주기")
2. **Precision Checklist** to vision_observe (full-body / shorts / neutral 오인 직접 nudge)
3. **Anchor Fidelity Rules** to prompt_synthesize (synthesis 일반화 강도 낮춤 — "asymmetric cross-strap cutout cropped tank" → "simple tank top" 류 변환 금지)
4. **Observation mapping 확장** — 새 슬롯들을 9 슬롯 (composition / subject / clothing_or_materials / environment / lighting_camera_style) 에 흡수
5. **Vision 모델 swap 옵션** — env var `STUDIO_VISION_MODEL=qwen3-vl:8b-thinking-q8_0` 으로 thinking 모델 비교 검증

**Tech Stack:** Python 3.13 / FastAPI / Ollama / qwen3-vl:8b 또는 qwen3-vl:8b-thinking-q8_0 / gemma4-un:latest 26B

**진단 근거:**
- `claudedocs/vision-pipeline-precision-brief.md` (5차 검증 결과 + 누락 매트릭스 + Root cause 갈래)
- ChatGPT(하루) 후속 답변 (이 plan 의 spec 그대로 채택)

**Spec 결정사항:**
1. **2-stage 구조 유지** (1순위 변경은 schema + checklist + anchor rules · 2-pass verifier 는 후순위 defer)
2. **Vision schema 확장 4 슬롯**: `face_detail` (eye_state / left_eye / right_eye / mouth_state / expression_notes) / `object_interaction` (object / object_position_relative_to_face / action) / `clothing_detail` (top_type / top_color / strap_layout / cutouts_or_openings / bottom_type / bottom_color / bottom_style_details) / `crowd_detail` (people_visible / raincoats_or_ponchos / crowd_clothing / crowd_focus)
3. **Backward compat**: 옛 슬롯 (`expression`, `clothing[]`, `accessories_or_objects[]`, `pose`, `hair`) 는 그대로 유지 — 새 슬롯이 추가될 뿐. 기존 통합 테스트 깨지지 않게.
4. **Observation mapping 흡수**: 새 슬롯들이 우선 매핑되고, 옛 슬롯은 fallback (vision 모델이 새 슬롯을 채우면 그걸 우선, 비어있으면 옛 슬롯)
5. **Banned terms 평가**: 새 슬롯 (예: `clothing_detail.cutouts_or_openings`) 도 `_has_observation_evidence` 의 evidence 검사에 포함 — `cutout` / `asymmetric` 같은 anchor 가 vision 에서 잡히면 text 가 사용해도 보존
6. **Thinking 모델 swap**: env var `STUDIO_VISION_MODEL=qwen3-vl:8b-thinking-q8_0` (사용자 다운 후) — 코드 변경 0 (Phase 6 의 env var 패턴 활용)
7. **테스트 카운트**: 절대값 박지 않음 — "신규 PASS + 기존 regression 0" 으로 검증

---

## File Structure

### Modified

```
backend/studio/vision_pipeline/
  vision_observe.py        (system prompt + schema 확장 — 약 +80 줄)
  prompt_synthesize.py     (system prompt + user message 확장 — 약 +20 줄)
  observation_mapping.py   (새 슬롯 매핑 + 옛 슬롯 fallback — 약 +60 줄)

backend/tests/
  test_vision_observe.py    (system prompt 검증 케이스 보강)
  test_prompt_synthesize.py (anchor fidelity 검증 케이스 보강)
  test_observation_mapping.py (새 슬롯 매핑 검증 추가)
  test_image_detail_v3.py   (mock observation 데이터 갱신 — 새 슬롯 포함)
```

(`__init__.py` / `image_detail.py` / `banned_terms.py` / `presets.py` 는 변경 없음 — schema 만 확장되고 호출 흐름 동일)

---

## 책임 분리

### vision_observe.py — Precision Checklist + Schema 확장
- 기존 schema 의 `subjects[]` 안에 4 새 nested object 추가: `face_detail`, `object_interaction`, `clothing_detail`
- 기존 `environment` 안에 1 새 nested object 추가: `crowd_detail`
- 옛 슬롯 (`expression`, `eyes`, `mouth`, `hair`, `pose`, `hands`, `clothing`, `accessories_or_objects`) 그대로 유지 — backward compat
- Rules 블록 위에 "Precision Observation Checklist" 새 블록 추가 (face/object/clothing/framing/background 각 5-6 조항)

### prompt_synthesize.py — Anchor Fidelity Rules
- 기존 `positive_prompt rules:` 끝에 "Anchor Fidelity Rules" 블록 추가:
  - "asymmetric cross-strap cutout cropped tank top" → "simple tank top" 변환 금지
  - "cup raised to lips" → "holding a cup" 변환 금지
  - "chest-up" / "upper-body" → "full-body" 변환 금지
  - "pants" / "cargo pants" → "shorts" 변환 금지
  - "transparent raincoats" / "plastic ponchos" → "silhouettes" 일반화 금지
- User message 마지막 줄 강화: "Preserve the exact visual anchors." → "Preserve exact visual anchors verbatim. Do not generalize distinctive clothing, facial expression, object interaction, framing, or background crowd details."

### observation_mapping.py — 새 슬롯 → 5 frontend 슬롯 흡수
- `subject` 슬롯: 옛 (`expression`, `pose`, `hair` 등) + 새 `face_detail.eye_state`, `face_detail.mouth_state`, `face_detail.expression_notes` 흡수
- `clothing_or_materials` 슬롯: 옛 (`clothing[]`, `accessories_or_objects[]`) + 새 `clothing_detail.top_type`, `top_color`, `strap_layout`, `cutouts_or_openings`, `bottom_type`, `bottom_color`, `bottom_style_details[]`, `object_interaction.object`, `object_position_relative_to_face`, `action` 흡수
- `environment` 슬롯: 옛 + 새 `crowd_detail.raincoats_or_ponchos`, `crowd_clothing[]` 흡수
- 우선순위: 새 슬롯이 채워졌으면 우선 사용, 비어있으면 옛 슬롯 fallback (backward compat)

---

## Phase 분할

- **Phase 1**: `vision_observe.py` system prompt + schema 확장 + 단위 테스트 보강
- **Phase 2**: `prompt_synthesize.py` anchor fidelity + user message 강화 + 단위 테스트 보강
- **Phase 3**: `observation_mapping.py` 새 슬롯 흡수 + 옛 슬롯 fallback + 단위 테스트 신규
- **Phase 4**: 통합 테스트 (`test_image_detail_v3.py`) mock observation 데이터 갱신 + 풀 회귀 검증
- **Phase 5**: 사용자 브라우저 검증 (qwen3-vl:8b vs qwen3-vl:8b-thinking-q8_0 비교 · Observation Score + Prompt Score 분리 채점)

각 Phase 내 commit 1번. 총 4 commit (Phase 5 는 사용자 검증이라 commit 없음).

---

## Phase 1: `vision_observe.py` — Precision Checklist + Schema 확장

**Files:**
- Modify: `backend/studio/vision_pipeline/vision_observe.py`
- Modify: `backend/tests/test_vision_observe.py`

### Task 1.1: vision_observe.py system prompt 확장

- [ ] **Step 1: 현재 `VISION_OBSERVATION_SYSTEM` 의 schema 부분 확인 후 새 슬롯 4개 추가**

기존 `subjects[]` 안에 새 nested object 3개 추가 (옛 필드 그대로 유지):

```python
"subjects": [
    {
      "count_index": 1,
      "apparent_age_group": "",
      "broad_visible_appearance": "",
      "face_direction": "",
      "expression": "",
      "eyes": "",
      "mouth": "",
      "hair": "",
      "pose": "",
      "hands": "",
      "clothing": [],
      "accessories_or_objects": [],
      "face_detail": {
        "eye_state": "",
        "left_eye": "",
        "right_eye": "",
        "mouth_state": "",
        "expression_notes": []
      },
      "object_interaction": {
        "object": "",
        "object_position_relative_to_face": "",
        "action": ""
      },
      "clothing_detail": {
        "top_type": "",
        "top_color": "",
        "strap_layout": "",
        "cutouts_or_openings": "",
        "bottom_type": "",
        "bottom_color": "",
        "bottom_style_details": []
      }
    }
  ],
```

기존 `environment` 안에 `crowd_detail` 추가:

```python
"environment": {
    "location_type": "",
    "foreground": [],
    "midground": [],
    "background": [],
    "weather_or_surface_condition": [],
    "crowd_detail": {
      "people_visible": "",
      "raincoats_or_ponchos": "",
      "crowd_clothing": [],
      "crowd_focus": ""
    }
  },
```

- [ ] **Step 2: 기존 "Rules:" 블록 위에 "Precision Observation Checklist" 새 블록 추가**

```text
Precision Observation Checklist:
Before filling the JSON, inspect the image for small but important visual anchors.

Face and expression:
- Check whether both eyes are open, one eye is closed, or one eye is partially closed.
- If one eye is closed or nearly closed while the other is open, describe it as "winking" or "one eye closed".
- Describe mouth state separately: closed mouth, open mouth, drinking, cup covering mouth, smile, neutral.

Object interaction:
- Do not write only "holding a cup" if the cup is close to the mouth.
- Specify whether the cup is raised to the lips, covering the mouth, held near the chest, or held down.

Clothing:
- Do not simplify distinctive garments.
- Look for asymmetric straps, cross straps, cutouts, cropped tops, side openings, cargo pockets, utility details, pants vs shorts.
- If unsure whether the bottom is shorts or pants, write "uncertain" instead of guessing.

Framing:
- Carefully distinguish full-body, thigh-up, waist-up, chest-up, close-up.
- Do not use full-body unless the full body from head to feet is visible.

Background:
- Look for rain, wet surfaces, transparent raincoats, plastic ponchos, stage lights, neon signs, concert or festival structures.
```

- [ ] **Step 3: 기존 5 단위 테스트 + 새 검증 케이스 1 추가**

`test_vision_observe.py` 의 `test_system_prompt_forbids_boilerplate` 옆에 새 메서드 추가:

```python
    def test_system_prompt_includes_precision_checklist(self) -> None:
        """Phase 5차 누락 영역 (윙크/cutout/cargo/우비/chest-up) 가
        Precision Checklist 에 명시되어 있다."""
        for cue in [
            "winking",
            "one eye closed",
            "raised to the lips",
            "asymmetric straps",
            "cross straps",
            "cutouts",
            "cargo pockets",
            "pants vs shorts",
            "chest-up",
            "transparent raincoats",
            "plastic ponchos",
        ]:
            assert cue in VISION_OBSERVATION_SYSTEM, (
                f"Precision Checklist missing cue: {cue!r}"
            )

    def test_system_prompt_schema_includes_new_detail_slots(self) -> None:
        """Schema 에 새 4 슬롯 (face_detail / object_interaction / clothing_detail / crowd_detail) 이 있다."""
        for slot in [
            "face_detail",
            "object_interaction",
            "clothing_detail",
            "crowd_detail",
            "eye_state",
            "object_position_relative_to_face",
            "strap_layout",
            "cutouts_or_openings",
            "raincoats_or_ponchos",
        ]:
            assert slot in VISION_OBSERVATION_SYSTEM, (
                f"Schema missing slot key: {slot!r}"
            )
```

- [ ] **Step 4: 테스트 실행 + 회귀**

Run: `cd /d/AI-Image-Studio/backend && /d/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/test_vision_observe.py -v`
Expected: 8 PASS (기존 6 + 신규 2)

Run: `cd /d/AI-Image-Studio/backend && /d/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 2 PASS + 기존 regression 0

- [ ] **Step 5: 커밋**

```bash
cd /d/AI-Image-Studio
git add backend/studio/vision_pipeline/vision_observe.py backend/tests/test_vision_observe.py
git commit -m "$(cat <<'EOF'
feat(vision): Precision Checklist + 4 schema 확장 (Recall Phase 1)

ChatGPT(하루) 후속 답변 채택 — 5차 검증의 정밀 복원 약점 (윙크 /
cutout / cargo / 우비 / chest-up 누락) 해결.

핵심: "자세히 봐" 보다 "자세히 볼 칸 만들어주기".

Schema 확장 (subjects[] 안):
  - face_detail: eye_state, left_eye, right_eye, mouth_state,
    expression_notes
  - object_interaction: object, object_position_relative_to_face,
    action
  - clothing_detail: top_type, top_color, strap_layout,
    cutouts_or_openings, bottom_type, bottom_color,
    bottom_style_details

Schema 확장 (environment 안):
  - crowd_detail: people_visible, raincoats_or_ponchos,
    crowd_clothing, crowd_focus

Precision Observation Checklist 새 블록:
  - 한쪽 눈 감음 (윙크) 명시 cue
  - cup raised to lips vs holding 구분
  - asymmetric / cross strap / cutouts 보존 cue
  - pants vs shorts uncertain 처리
  - chest-up / waist-up / full-body 구분
  - transparent raincoats / plastic ponchos 명시

옛 필드 (expression, clothing[], pose 등) 그대로 유지 — backward
compat. 새 슬롯이 우선 채워지고 옛 슬롯은 fallback.

테스트 2 신규 (Precision Checklist + 새 슬롯 검증).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: `prompt_synthesize.py` — Anchor Fidelity Rules

**Files:**
- Modify: `backend/studio/vision_pipeline/prompt_synthesize.py`
- Modify: `backend/tests/test_prompt_synthesize.py`

### Task 2.1: Anchor Fidelity Rules + user message 강화

- [ ] **Step 1: `PROMPT_SYNTHESIZE_SYSTEM` 끝에 "Anchor Fidelity Rules" 블록 추가**

기존 `negative_prompt rules:` 블록 끝에 다음 새 블록 추가:

```text
Anchor Fidelity Rules:
- The positive_prompt must preserve the most specific visual phrases from the observation JSON.
- Do not replace specific details with generic wording.
- Reuse distinctive observation phrases verbatim when possible.
- Do not simplify "asymmetric cross-strap cutout cropped tank top" to "simple tank top".
- Do not simplify "cup raised to lips" to "holding a cup".
- Do not change "chest-up", "upper-body", or "waist-up" into "full-body".
- Do not change "pants", "cargo pants", or "utility pants" into "shorts".
- Do not change "transparent raincoats" or "plastic ponchos" into generic "silhouettes".
- If the observation says a detail is uncertain, phrase it as uncertain rather than replacing it with a confident guess.
- Visual accuracy is more important than elegant prose.
```

- [ ] **Step 2: User message 강화 (synthesize_prompt 함수 안)**

기존:
```python
user_content = (
    "Convert this visual observation JSON into a generation-ready prompt.\n"
    "Preserve the exact visual anchors.\n"
    "Do not add unsupported camera or lighting claims.\n\n"
    f"```json\n{json.dumps(observation, ensure_ascii=False, indent=2)}\n```"
)
```

새:
```python
user_content = (
    "Convert this visual observation JSON into a generation-ready prompt.\n"
    "Preserve exact visual anchors verbatim. Do not generalize distinctive "
    "clothing, facial expression, object interaction, framing, or background "
    "crowd details.\n"
    "Do not add unsupported camera or lighting claims.\n\n"
    f"```json\n{json.dumps(observation, ensure_ascii=False, indent=2)}\n```"
)
```

- [ ] **Step 3: 단위 테스트 1 신규 (Anchor Fidelity Rules 검증)**

`test_prompt_synthesize.py` 의 `test_system_prompt_forbids_boilerplate_unless_supported` 옆에 추가:

```python
    def test_system_prompt_includes_anchor_fidelity_rules(self) -> None:
        """Anchor Fidelity Rules 가 일반화 금지 cue 들을 명시한다."""
        for forbidden_generalization in [
            "Anchor Fidelity Rules",
            "asymmetric cross-strap cutout cropped tank top",
            "simple tank top",
            "cup raised to lips",
            "holding a cup",
            "chest-up",
            "full-body",
            "cargo pants",
            "shorts",
            "transparent raincoats",
            "plastic ponchos",
            "silhouettes",
            "Visual accuracy is more important than elegant prose",
        ]:
            assert forbidden_generalization in PROMPT_SYNTHESIZE_SYSTEM, (
                f"PROMPT_SYNTHESIZE_SYSTEM missing fidelity rule: "
                f"{forbidden_generalization!r}"
            )
```

- [ ] **Step 4: 테스트 실행 + 회귀**

Run: `cd /d/AI-Image-Studio/backend && /d/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/test_prompt_synthesize.py -v`
Expected: 6 PASS (기존 5 + 신규 1)

Run: `cd /d/AI-Image-Studio/backend && /d/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 1 PASS + 기존 regression 0

- [ ] **Step 5: 커밋**

```bash
cd /d/AI-Image-Studio
git add backend/studio/vision_pipeline/prompt_synthesize.py backend/tests/test_prompt_synthesize.py
git commit -m "$(cat <<'EOF'
feat(vision): Anchor Fidelity Rules — synthesis 일반화 금지 (Recall Phase 2)

5차 검증의 synthesis 일반화 약점 (40% root cause) 직격:
  - vision 이 "asymmetric cross-strap cutout cropped tank with cutouts"
    줘도 text 가 "simple tank top" 으로 일반화 → 금지
  - vision 이 "cup raised to lips" 줘도 text 가 "holding a cup" 으로
    약화 → 금지
  - "chest-up" → "full-body" 오인 금지
  - "cargo pants" → "shorts" 오인 금지
  - "transparent raincoats" → "silhouettes" 일반화 금지

system prompt 새 블록 "Anchor Fidelity Rules" — 옛 boilerplate
금지 리스트 (muted earth tones 등) 와 별개로 specific phrase
preservation 강제.

User message 마지막 줄도 강화: "Preserve exact visual anchors
verbatim. Do not generalize ..." 으로 명시.

테스트 1 신규 (Anchor Fidelity Rules 모든 cue 검증).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: `observation_mapping.py` — 새 슬롯 흡수 + 옛 슬롯 fallback

**Files:**
- Modify: `backend/studio/vision_pipeline/observation_mapping.py`
- Modify: `backend/tests/test_observation_mapping.py`

### Task 3.1: 새 슬롯 우선 매핑 + 옛 슬롯 fallback

- [ ] **Step 1: `_format_subject` 함수 확장 — 새 슬롯 우선, 옛 슬롯 fallback**

기존:
```python
def _format_subject(s: dict[str, Any], idx: int) -> str:
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
```

새 (face_detail 우선 + 옛 fallback):
```python
def _format_subject(s: dict[str, Any], idx: int) -> str:
    """단일 subject dict → 사람이 읽을 수 있는 문장.

    face_detail 새 슬롯이 채워졌으면 우선 사용, 비어있으면 옛 expression/
    eyes/mouth fallback.
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
```

- [ ] **Step 2: clothing_or_materials 매핑 확장 — clothing_detail 우선 + object_interaction + 옛 fallback**

`map_observation_to_slots` 함수 안의 clothing 매핑 부분을 새 헬퍼로 분리:

```python
def _format_clothing(subjects: list[dict[str, Any]]) -> str:
    """clothing_or_materials 슬롯 — clothing_detail 새 슬롯 우선 + object_interaction + 옛 fallback."""
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

        # object_interaction (cup raised to lips 같은)
        oi = s.get("object_interaction") if isinstance(s.get("object_interaction"), dict) else {}
        oi_obj = oi.get("object") or ""
        oi_pos = oi.get("object_position_relative_to_face") or ""
        oi_act = oi.get("action") or ""
        if oi_obj:
            oi_phrase = _join_nonempty([oi_obj, oi_pos, oi_act], sep=", ")
            parts.append(oi_phrase)

        # 옛 슬롯 fallback (clothing_detail 비어있으면 옛 사용)
        if not top_phrases and not bottom_phrases:
            old_clothing = s.get("clothing") or []
            if isinstance(old_clothing, list):
                parts.extend(old_clothing)

        # accessories_or_objects 는 옛/신 둘 다 그대로 (object_interaction 과 보완)
        accessories = s.get("accessories_or_objects") or []
        if isinstance(accessories, list) and not oi_obj:
            parts.extend(accessories)

    return _join_nonempty(parts)
```

`map_observation_to_slots` 안에서 기존 clothing 루프를 `clothing_or_materials = _format_clothing(subjects)` 로 교체.

- [ ] **Step 3: environment 매핑 확장 — crowd_detail 흡수**

기존 environment 매핑 부분 갱신:

```python
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
```

- [ ] **Step 4: 단위 테스트 2 신규 (새 슬롯 매핑 검증 + 옛 슬롯 fallback)**

`test_observation_mapping.py` 끝에 추가:

```python
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
        # 옛 expression "neutral" 은 새 eye_state 가 있으니 우선되지 않음

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
                    "people_visible": "dense crowd of about 30 people",
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
```

- [ ] **Step 5: 테스트 실행 + 회귀**

Run: `cd /d/AI-Image-Studio/backend && /d/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/test_observation_mapping.py -v`
Expected: 9 PASS (기존 5 + 신규 4)

Run: `cd /d/AI-Image-Studio/backend && /d/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ --tb=short -q`
Expected: 신규 4 PASS + 기존 regression 0 (기존 `test_full_observation_maps_all_slots` 같은 테스트가 옛 슬롯만 사용하므로 fallback 으로 통과)

- [ ] **Step 6: 커밋**

```bash
cd /d/AI-Image-Studio
git add backend/studio/vision_pipeline/observation_mapping.py backend/tests/test_observation_mapping.py
git commit -m "$(cat <<'EOF'
feat(vision): observation_mapping 새 슬롯 흡수 (Recall Phase 3)

Phase 1 의 schema 확장 (face_detail / object_interaction /
clothing_detail / crowd_detail) 을 frontend 5 슬롯 (subject /
clothing_or_materials / environment) 에 흡수.

매핑 우선순위:
  - 새 슬롯이 채워졌으면 우선 사용
  - 새 슬롯 비어있으면 옛 슬롯 fallback (backward compat)

clothing_or_materials 흡수:
  - clothing_detail.top_color/strap_layout/cutouts_or_openings/top_type
  - clothing_detail.bottom_color/bottom_type/bottom_style_details
  - object_interaction.object/position_relative_to_face/action
    (cup raised to lips 같은)
  - 옛 clothing[] / accessories_or_objects[] fallback

subject 흡수:
  - face_detail.eye_state (winking 등) > 옛 expression
  - face_detail.mouth_state (cup at lips 등) > 옛 mouth
  - face_detail.expression_notes (one eye closed 등)

environment 흡수:
  - crowd_detail.raincoats_or_ponchos (transparent raincoats 등)
  - crowd_detail.crowd_clothing/crowd_focus/people_visible

테스트 4 신규 (새 슬롯 우선 매핑 + 옛 슬롯 fallback 검증).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: 통합 테스트 mock 갱신 + 풀 회귀

**Files:**
- Modify: `backend/tests/test_image_detail_v3.py` (mock observation 데이터에 새 슬롯 추가)

### Task 4.1: 통합 테스트 mock 데이터 갱신

- [ ] **Step 1: `test_full_success_path` 의 mock_observation 에 새 슬롯 추가**

기존 mock_observation 의 첫 subject 에 face_detail / object_interaction / clothing_detail 추가, environment 에 crowd_detail 추가:

```python
        mock_observation: dict[str, Any] = {
            "image_orientation": "portrait",
            "framing": {"crop": "chest-up", "camera_angle": "slight upward"},
            "subjects": [
                {
                    "count_index": 1,
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "East Asian female",
                    "expression": "winking",  # 옛 (backward compat)
                    "hair": "long wet dark hair",
                    "clothing": ["gray cropped tank with cutouts"],  # 옛 fallback
                    # 새 슬롯
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
```

기존 assertion 들 (예: `assert "East Asian female" in result.subject`, `assert "cropped tank" in result.clothing_or_materials`) 그대로 유지 + 새 anchor 검증 추가:

```python
        # 새 슬롯 우선 매핑 검증
        assert "winking" in result.subject  # face_detail.eye_state
        assert "raised to lips" in result.clothing_or_materials  # object_interaction
        assert "cargo pants" in result.clothing_or_materials  # clothing_detail.bottom_type
        assert "asymmetric cross-strap" in result.clothing_or_materials  # clothing_detail
        assert "side cutouts" in result.clothing_or_materials  # clothing_detail
        assert "transparent plastic raincoats" in result.environment  # crowd_detail
```

- [ ] **Step 2: `test_text_failure_uses_observation_fallback_positive` 의 mock_observation 에도 최소한의 새 슬롯 추가 (Caucasian male 케이스 그대로 유지하고 필요시 보강)**

기존 케이스의 의미 (text 실패 시 observation 기반 짧은 positive 자동 합성) 보존하면서 새 슬롯 흡수 검증:

```python
        mock_observation = {
            "subjects": [
                {
                    "apparent_age_group": "young adult",
                    "broad_visible_appearance": "Caucasian male",
                    "clothing_detail": {  # 새 슬롯 (선택)
                        "top_type": "white t-shirt",
                        "top_color": "white",
                    },
                }
            ],
            "environment": {"location_type": "studio"},
            "lighting_and_color": {"visible_light_sources": ["softbox key light"]},
        }
```

기존 assertion (`"Caucasian male" in result.positive_prompt` 등) 그대로 유지 + 신규:

```python
        # 새 clothing_detail 도 fallback positive 에 흡수됨
        assert "white" in result.positive_prompt or "t-shirt" in result.positive_prompt
```

- [ ] **Step 3: 테스트 실행 + 풀 회귀**

Run: `cd /d/AI-Image-Studio/backend && /d/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/test_image_detail_v3.py -v`
Expected: 4 PASS (모두 통과 — 새 anchor 검증 + 옛 검증 유지)

Run: `cd /d/AI-Image-Studio/backend && /d/AI-Image-Studio/.venv/Scripts/python.exe -m pytest tests/ --tb=short -q`
Expected: 모든 phase 1-3 + 4 신규 안 깨짐 + 기존 regression 0

Run: `cd /d/AI-Image-Studio/frontend && npm test -- --run 2>&1 | tail -10`
Expected: vitest 178 PASS (frontend 변경 0)

Run: `cd /d/AI-Image-Studio/frontend && npx tsc --noEmit 2>&1 | tail -5`
Expected: clean

- [ ] **Step 4: 커밋**

```bash
cd /d/AI-Image-Studio
git add backend/tests/test_image_detail_v3.py
git commit -m "$(cat <<'EOF'
test(vision): image_detail_v3 mock 데이터 새 슬롯 갱신 (Recall Phase 4)

Phase 1-3 의 schema 확장 (face_detail / object_interaction /
clothing_detail / crowd_detail) 이 통합 흐름 (vision_observe →
prompt_synthesize → banned_terms → mapping → fallback) 끝까지
정상 흡수되는지 검증.

mock_observation 에 새 슬롯 추가 + 옛 슬롯 (expression, clothing[])
도 backward compat 검증용으로 유지.

추가 anchor assertion:
  - winking (face_detail.eye_state)
  - raised to lips (object_interaction)
  - cargo pants / asymmetric cross-strap / side cutouts
    (clothing_detail)
  - transparent plastic raincoats (crowd_detail)

vitest 178 / pytest 풀 PASS / regression 0 / tsc clean.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: 사용자 브라우저 검증 (수동 · qwen3-vl 비교)

### Task 5.1: 같은 카리나 이미지 3 모드 비교 (Observation + Prompt 분리 채점)

- [ ] **Step 1: backend 재시작 (Vision Recall 적용)**

```powershell
$env:STUDIO_VISION_DEBUG = "1"  # raw observation 보기
cd D:\AI-Image-Studio\backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log
```

- [ ] **Step 2: 모드 A — qwen3-vl:8b (default · 기존)**

env var 없이 backend 시작. 카리나 이미지 분석 → 결과 + raw observation 캡처.

- [ ] **Step 3: 모드 B — qwen3-vl:8b-thinking-q8_0 (사용자 다운로드 끝나면)**

```powershell
# backend 종료 후 env 변경하고 재시작
$env:STUDIO_VISION_MODEL = "qwen3-vl:8b-thinking-q8_0"
$env:STUDIO_VISION_DEBUG = "1"
cd D:\AI-Image-Studio\backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log
```

같은 카리나 이미지 분석 → 결과 + raw observation 캡처.

- [ ] **Step 4: 분리 채점 (ChatGPT(하루) 권장)**

| 항목 | A: 8b | B: 8b-thinking | 점수 |
|---|---|---|---|
| **Observation Score** (vision raw 가 anchor 잡았나) | | | |
| - face_detail.eye_state = winking | ☐ | ☐ | 15 |
| - object_interaction.object_position_relative_to_face ≈ lips | ☐ | ☐ | 10 |
| - clothing_detail.strap_layout ≈ asymmetric/cross | ☐ | ☐ | 15 |
| - clothing_detail.cutouts_or_openings 채워짐 | ☐ | ☐ | 10 |
| - clothing_detail.bottom_type = pants/cargo (NOT shorts) | ☐ | ☐ | 10 |
| - crowd_detail.raincoats_or_ponchos 채워짐 | ☐ | ☐ | 10 |
| - framing.crop = chest-up (NOT full-body) | ☐ | ☐ | 5 |
| **Prompt Score** (text 가 observation anchor 보존했나) | | | |
| - "winking" / "one eye closed" 보존 | ☐ | ☐ | 10 |
| - "raised to lips" / "cup at mouth" 보존 | ☐ | ☐ | 5 |
| - "asymmetric" / "cutouts" 보존 | ☐ | ☐ | 5 |
| - "cargo pants" 보존 (NOT shorts) | ☐ | ☐ | 5 |

→ **Observation Score** 가 낮으면: vision capacity 한계 (8B 모델 못 봄) → 모델 변경 (32b) 또는 2-pass verifier 필요
→ **Observation Score** 높지만 **Prompt Score** 낮으면: prompt_synthesize 일반화 → Anchor Fidelity Rules 추가 강화 필요

- [ ] **Step 5: 결정 시 master merge (이전과 동일 패턴)**

ChatGPT(하루) "1순위" 액션 (1-5 항목) 다 적용 후, 점수 분석 → master merge 또는 후속 (2-pass verifier / 32b 모델) 결정.

---

## Self-Review Checklist (post-write)

### 1. Spec coverage

- [x] ChatGPT 후속 답변 §A "prompt_synthesize.py 수정 방향" → Phase 2 (Anchor Fidelity Rules + user message)
- [x] ChatGPT 후속 답변 §B "vision_observe.py 수정 방향" → Phase 1 (Precision Checklist + schema 확장)
- [x] ChatGPT 후속 답변 §최적화 "1. Vision system prompt 추가 블록" → Phase 1 Step 2
- [x] ChatGPT 후속 답변 §최적화 "2. Vision schema 보강" → Phase 1 Step 1
- [x] ChatGPT 후속 답변 §최적화 "3. Text synthesis system prompt 추가 블록" → Phase 2 Step 1
- [x] ChatGPT 후속 답변 §최적화 "user message 수정" → Phase 2 Step 2
- [x] ChatGPT 후속 답변 §"Thinking 모델 테스트 포인트" → Phase 5 (env var swap 비교 검증)
- [x] ChatGPT 후속 답변 §"테스트 — Observation Score + Prompt Score 분리" → Phase 5 Step 4
- [x] ChatGPT 후속 답변 §"2-pass vision verifier" — 후순위 defer 명시 (Phase 5 점수 부족 시 별 plan)
- [x] Backward compat — 옛 슬롯 (expression, clothing[], pose 등) 그대로 유지 → Phase 3 fallback 매핑

### 2. Placeholder scan

- ✅ "TBD" / "TODO" 0건
- ✅ "Add appropriate error handling" 0건
- ✅ "Similar to Task N" 0건
- ✅ 모든 코드 블록 풀 인용 (system prompt + schema + 매핑 헬퍼 + 테스트)

### 3. Type consistency

- ✅ schema 새 슬롯 keys 일관 (face_detail / object_interaction / clothing_detail / crowd_detail)
- ✅ 매핑 우선순위 일관 (새 슬롯 > 옛 슬롯)
- ✅ `_format_subject` / `_format_clothing` 헬퍼 시그니처 일관

### 4. 외부 호환

- ✅ `analyze_image_detailed()` 시그니처 변경 0
- ✅ `VisionAnalysisResult` 9 슬롯 동일
- ✅ frontend / pipelines / routes / DB schema 변경 0
- ✅ `__init__.py` facade 변경 0 (새 슬롯은 schema 내부 — public API 없음)
- ✅ env var (`STUDIO_VISION_MODEL` 등) 그대로 사용 (Phase 6 의 패턴 활용)
