# Vision Card Mapping Fix (옵션 B)

작성일: 2026-05-04 (v3.3 — 사용자 5 케이스 검증 + Codex 3차 리뷰 반영)
상태: 구현 완료 · pytest 474 PASS / vitest 178 PASS / 사용자 5 케이스 6/6 production 품질 확인 · commit 단계
근거 세션: 카리나 이미지 6차 검증 (master `18b93fd`) — 통합 프롬프트 75-85점 production 품질 확보됐으나, **디테일 카드 6개 중 5개가 평문 콤마 join 으로 의미 손실**. observation JSON 자체는 정상 (통합 프롬프트가 증거).

## 0. 변경 이력

### v1 → v2 (사용자 1차 리뷰)

- **`SENTINEL_VALUES` 전역 리스트 축소** — `yes/no/true/false/subject` 제거. 이유: 라벨 prefix 가 붙으면 의미가 살아남 (`raincoats: yes` 등). 라벨 없는 join 에서 leak 되는 sentinel 만 차단.
- **boolean 값은 필드별 `_format_yes_no` helper** 로 분리 처리 (raincoats_or_ponchos / people_visible).
- **subject 카드 라벨 `holding` → `interaction`** — 이미 `hands: holding a cup` 가 있어 중복 회피.
- **의상 카드도 sub-label** (`top: … · bottom: … · accessories: …`) — 단순 join 보다 가독성 ↑.
- **raincoats dedup 키워드 다양화** — `raincoat/raincoats/poncho/ponchos/plastic rainwear/transparent rainwear/clear poncho/rain coat`.
- **focus_target 처리 차별화** — `focus: subject` (단독) drop / `focus: subject face and cup` (구체) 표시 / `focus: none` sentinel 자동 drop.
- **contrast=high / dof=shallow 살림** — sentinel 아님. 라벨 prefix 덕분에 의미가 산다.

### v2 → v3 (Codex 2차 리뷰)

- **`accessories` 에서 `object_interaction.object` 와 중복되는 항목 제거** — 컵이 interaction 에 있을 때 accessories 에 또 cup 남으면 카드 간 누수. 동일 단어 (대소문자 무시 substring) 인 accessories 항목은 skip.
- **`SENTINEL_VALUES` 에 `"not specified"` 추가** — 모델들이 흔히 쓰는 placeholder.
- **신규 테스트 4 → 5** — lighting 카드 전용 회귀 방지 테스트 추가 (contrast/dof 살아남기 + style "none" 제거 + focus "subject" 제거).

### v3 → v3.1 (사용자 1차 검증 후속)

- **환경 카드도 sub-label 도입** — `location: … · scene: … · weather: … · crowd: …` (이전엔 평문 콤마. plastic cup 누수 + raincoats 중복 + dozens descriptor 떠다님이 한 번에 해결).
- **environment.foreground/midground/background 에서 `object_interaction.object` substring 일치 항목 dedup** — env 누수 차단 (`plastic cup` 환경에 박힘 → 제거).
- **foreground 안 RAINWEAR 자체 dedup** — `transparent ponchos + rain ponchos` 같이 한 리스트 안 동의어 중복 시 1개만 유지.
- **단일 인물 시 `subject 1:` prefix 생략** — 다중일 때만 `subject 1:` / `subject 2:` (단일 인물 카드의 어색함 해소).
- **`_format_subject` 시그니처에서 `idx` 인자 제거** — `map_observation_to_slots` 가 prefix 결정 (단일/다중 분기).
- **신규 helper**: `_collect_interaction_objects` / `_strip_interaction_objects` / `_dedup_rainwear`.

### v3.1 → v3.2 (사용자 2차 검증 후속)

- **scene 항목에서 단독 `subject`/`subjects` 단어 drop** — `scene: subject, neon lights` 같은 누수 차단 (lighting 의 focus_target 처리 패턴 재사용).
- **crowd_detail 안 RAINWEAR self-dedup** — `raincoats_or_ponchos="transparent raincoats"` + `crowd_clothing=["rain ponchos"]` 동의어 중복 시 후자 제거.
- **crowd join 순서 변경** — `people_phrase` 가 먼저 (자연 어순). `crowd: …, a few` → `crowd: a few, …`.
- **신규 helper**: `_drop_subject_word`.

### v3.2 → v3.3 (사용자 4 케이스 검증 + Codex 3차 리뷰)

- **clothing_detail 안 boolean `yes` 누수 차단** — `cutouts_or_openings="yes"` → `with cutouts` 라벨링 / `strap_layout="yes"` → drop / 정상 string ("single shoulder strap") → 보존.
- **crowd_focus 안 subject 참조 표현 정규화 매칭 drop** — `on the subject` / `On The Subjects` / `focused on subject` 등 11개 phrase + 대소문자/공백 흔들림.
- **신규 helper**: `_norm` (정규화) + 상수 `SUBJECT_REFERENCE_PHRASES` (11개).

### 검증 결과 (사용자 5 케이스 실측)

- 카리나 이미지 (3 분석) + 다른 이미지 (2 분석 · 8B + Thinking) → **6/6 production 품질** (5 카드 + 불확실)
- 환경 (없음) 1 케이스 발견됐지만 모델 variance 확정 (재분석 시 환경 4 sub-label 채워짐)
- `pose: standing, holding a cup` ↔ `hands: right hand holding a cup` 동의어 중복은 **모델 출력 paradigm 결함** — mapping 단으로 잡기 invasive · 후속 plan 후보로 박제

### 비-목표 (이번 plan 범위 밖 · 후속 plan 후보)

- 🟡 `vision_observe.py` system prompt 강화 — environment 항상 채우기 + `clothing_detail.bottom_*` 강조 + drink type 보수적 (`glass of beer` → `cup with light-colored drink`)
- 🟡 ko 번역 quality — `긴고` 오타 + "depth of field" 영어 잔존 + "웨이스트 업 샷" 직역 + "물" specific 가정
- 🟢 pose ↔ hands 동의어 중복 (모델 paradigm)
- 🟢 crowd 자연어 generation (`a few people wearing transparent rain ponchos`)
- 🟢 윙크 인식 (8B vision capacity 한계 · 32B 비교 또는 2-pass verifier · 메모리 박제됨)

## 1. 진단 요약

| 카드 | 잘못된 표시 | 결함 |
|------|-------------|------|
| 구도 | `vertical, close-up, eye-level, centered` | sub-label 부재 (의미는 살아있음 — fix 시급도 낮음) |
| 피사체 | `…— forward, both open, closed, long, dark, wet, standing, holding a cup, neutral` | **차원 라벨 손실** + `eye_state or expression_old` OR 오설계 (차원 혼합) |
| 의상·재질 | `…crop top, light beige pants…, cup, held to mouth, drinking` | `object_interaction` (인물 동작) 이 의상에 끼어듦 |
| 환경 | `…wet surfaces, **yes**, raincoats, on th…` | `people_visible="yes"` boolean leak + raincoats foreground/crowd_detail 중복 |
| 조명·카메라 | `…red, blue, gray, **high**, **shallow**, **subject**, **none**` | sentinel leak 4건 (`contrast=high` / `dof=shallow` / `focus_target=subject` / `style_evidence=["none"]`) |
| 불확실 | (없음) | 정상 |

## 2. 근본 원인 3개

1. **`_join_nonempty()` sentinel 무필터** (`backend/studio/vision_pipeline/observation_mapping.py:21-24`) — `if x and str(x).strip()` 만 검사 → `"none"`, `"yes"`, `"no"`, `"true"`, `"false"`, `"subject"`, `"null"`, `"n/a"` 같은 placeholder 통과
2. **sub-label prefix 부재** — 다차원 값을 평문 콤마 join 하니 `closed` 가 어떤 차원인지 불명
3. **`_format_subject` 의 `eye_state or expression_old` 차원 혼합** (`observation_mapping.py:52`) — eye_state 가 비면 expression 이 eye 자리로 들어가는 의미 오염

부수: raincoats 가 `env.foreground` + `crowd_detail.raincoats_or_ponchos` 에 이중 등록.

## 3. 변경 사항

### 3.1. `_join_nonempty` 보강 — 라벨 없는 join 의 sentinel filter (축소판)

```python
# 의미 없는 placeholder 만 — yes/no/true/false/subject 는 제외
# (formatter 가 라벨 붙이면 살아나는 값들이라 전역 차단 X)
SENTINEL_VALUES = frozenset({
    "none", "null", "n/a", "na", "unknown",
    "unspecified", "not specified", "not visible", "not applicable",
})

def _join_nonempty(items, sep=", "):
    parts = []
    for x in items:
        if not x:
            continue
        s = str(x).strip()
        if not s or s.lower() in SENTINEL_VALUES:
            continue
        parts.append(s)
    return sep.join(parts)


def _format_yes_no(yes_label: str, value: Any) -> str:
    """필드별 boolean 처리 — yes → yes_label / no → "" / 그 외 → 원문 보존."""
    v = str(value or "").strip()
    if not v:
        return ""
    low = v.lower()
    if low in {"yes", "true"}:
        return yes_label
    if low in {"no", "false"}:
        return ""
    return v
```

### 3.2. `_format_subject` 재구성 — sub-label prefix + 차원 분리 + interaction 라벨

```python
labeled = [
    ("face", s.get("face_direction")),
    ("eyes", eye_state or eyes_old),       # eye 차원만 — OR 오설계 fix
    ("mouth", mouth_state or mouth_old),    # mouth 차원만
    ("expression", _join_nonempty([expression_old, *expression_notes], sep=" / ")),
    ("hair", s.get("hair")),
    ("pose", s.get("pose")),
    ("hands", s.get("hands")),
    # object_interaction (cup raised to lips) 도 여기로 이동 — 라벨은 'interaction'
    ("interaction", _format_object_interaction(s)),
]
detail = " · ".join(f"{lbl}: {val}" for lbl, val in labeled if val)
```

표시 예: `subject 1: young adult East Asian female — face: forward · eyes: both open · mouth: closed · expression: neutral · hair: long, dark, wet · pose: standing · hands: holding a cup · interaction: cup raised to lips, drinking`

### 3.3. `_format_clothing` — sub-label prefix + object_interaction 제거

```python
parts: list[str] = []
for s in subjects:
    cd = s.get("clothing_detail") or {}
    top_phrases = _join_nonempty([
        cd.get("top_color"), cd.get("strap_layout"),
        cd.get("cutouts_or_openings"), cd.get("top_type"),
    ], sep=" ")
    bottom_phrases = _join_nonempty([
        cd.get("bottom_color"), cd.get("bottom_type"),
        _join_nonempty(cd.get("bottom_style_details") or [], sep=" "),
    ], sep=" ")

    # accessories 에서 object_interaction.object 와 중복되는 항목 제거 (v3 보강)
    oi_obj = (s.get("object_interaction") or {}).get("object") or ""
    oi_obj_low = str(oi_obj).strip().lower()
    raw_accessories = s.get("accessories_or_objects") or []
    if isinstance(raw_accessories, list) and oi_obj_low:
        raw_accessories = [
            a for a in raw_accessories
            if not (isinstance(a, str) and oi_obj_low in a.lower())
        ]
    accessories = _join_nonempty(raw_accessories)

    labeled = [
        ("top", top_phrases),
        ("bottom", bottom_phrases),
        ("accessories", accessories),
    ]
    parts.extend(f"{lbl}: {val}" for lbl, val in labeled if val)
return " · ".join(parts)
```

표시 예: `top: gray asymmetric (one strap over shoulder) side cutouts crop top · bottom: light beige pants waistband with button`

`object_interaction` 은 피사체 카드 (`interaction:` 라벨) 로 이동.
`accessories_or_objects` 는 object_interaction.object 와 중복되는 항목 (cup 등) 만 제외하고 의상 카드 `accessories:` 라벨로.

### 3.4. environment — raincoats dedup (키워드 확장) + boolean formatter

```python
RAINWEAR_KEYWORDS = (
    "raincoat", "raincoats", "poncho", "ponchos",
    "plastic rainwear", "transparent rainwear",
    "clear poncho", "rain coat", "rain coats",
)

def _has_rainwear(text: str) -> bool:
    low = text.lower()
    return any(kw in low for kw in RAINWEAR_KEYWORDS)


# crowd_detail.raincoats_or_ponchos: yes → "raincoats visible" / 그 외 → 원문
rain_phrase = _format_yes_no("raincoats visible", crowd.get("raincoats_or_ponchos"))

# crowd_detail.people_visible: yes → "people visible" / 그 외 (descriptor) → 원문
people_phrase = _format_yes_no("people visible", crowd.get("people_visible"))

# crowd_detail 에서 rainwear 가 잡혔으면 env.foreground 의 rainwear 항목 skip
foreground_items = env.get("foreground") or []
if rain_phrase and _has_rainwear(rain_phrase):
    foreground_items = [x for x in foreground_items if not (isinstance(x, str) and _has_rainwear(x))]
```

### 3.5. lighting_camera — sub-label prefix + focus_target 차별화

```python
focus = (photo.get("focus_target") or "").strip()
# 단독 "subject"/"subjects" 는 너무 기본값이라 drop, 구체 표현은 보존
if focus.lower() in {"subject", "subjects"}:
    focus = ""

labeled_l = [
    ("lights", _join_nonempty(visible_light_sources)),
    ("colors", _join_nonempty(dominant_colors)),
    ("contrast", contrast),       # "high"/"low" 살림 (라벨 덕분에 의미 산다)
    ("dof", depth_of_field),      # "shallow"/"deep" 살림
    ("focus", focus),
    ("style", _join_nonempty(style_evidence)),  # ["none"] 은 3.1 에서 drop
]
```

표시 예: `lights: neon signs, stage lights · colors: red, blue, gray · contrast: high · dof: shallow`

### 3.6. composition — sub-label prefix (소규모)

```python
labeled_c = [
    ("orientation", orientation),
    ("crop", framing.get("crop")),
    ("angle", framing.get("camera_angle")),
    ("position", framing.get("subject_position")),
]
```

표시 예: `orientation: vertical · crop: close-up · angle: eye-level · position: centered`

## 4. 검증 기준

- **pytest 446 → 446** PASS 유지 (test_observation_mapping.py 갱신 필요 케이스 1건만 — `raised to lips` 가 의상 → 피사체 카드로 이동)
- **신규 테스트 5개 추가**: sentinel filter / sub-label prefix / object_interaction 카드 이동 / raincoats dedup / lighting 회귀 방지 (contrast=high · dof=shallow 살아남기 · style ["none"] 제거 · focus="subject" 제거)
- **vitest 178** 영향 없음 (frontend 표시 형식 변경만 — DetailCard 가 string 표시라 schema 안 바뀜)
- **tsc / lint clean**
- **사용자 카리나 이미지 재분석** 으로 6 카드 모두 의미 회복 + sentinel leak 0건 확인

## 5. 비-목표 (이번 plan 범위 X)

- `vision_observe.py` schema 변경 — observation 자체는 정상이라 손대지 않음
- `prompt_synthesize.py` (gemma4 작문) — 이미 production 품질
- frontend RecipeV2View / DetailCard CSS — 카드 텍스트 잘림 ("h…", "woma…") 은 mapping fix 후 재평가
- 8B vs Thinking 비교 자동화 / 결과 헤더 모델 pill — 별도 후속 plan

## 6. 박제 후 단계

1. plan 박제 (이 문서)
2. `_join_nonempty` + `_format_subject` + `_format_clothing` + composition/environment/lighting 재작성
3. `test_observation_mapping.py` `raised to lips` 위치 갱신 + 신규 4 케이스
4. pytest 446 + vitest 178 회귀
5. 카리나 이미지 브라우저 재분석 → 사용자 OK
6. commit (`fix(vision): 디테일 카드 mapping 의미 회복 — sub-label prefix + sentinel filter`)
