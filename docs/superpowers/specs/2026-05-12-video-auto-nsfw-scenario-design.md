# Video 자동 NSFW 시나리오 생성 (Spec v1.1)

**작성일**: 2026-05-12 (v1.0 초안) · 2026-05-12 v1.1 갱신 (Codex 리뷰 1라운드 12/12 수용)
**상태**: 기획 v1.1 (구현 준비 완료)
**작성자**: Opus 4.7 (사용자 공동 기획 · Codex iterative review)
**대상 파일**: `docs/superpowers/specs/2026-05-12-video-auto-nsfw-scenario-design.md`
**관련 spec**:
- `docs/superpowers/specs/2026-05-11-video-vision-pipeline-improvement-design.md` (Wan22/LTX gemma4 분기 기반)
- `docs/superpowers/specs/2026-05-03-video-model-selection-wan22.md` (영상 모델 듀얼 도입)

---

## 0. v1.0 → v1.1 변경 요약 (Codex review 1라운드 — 12/12 전체 수용)

| # | Codex finding (severity) | v1.0 (초안) | v1.1 (현재) |
|---|--------------------------|-------------|-------------|
| 1 | /video 전송 방식 (**High**) | `auto_nsfw`/`nsfw_intensity` multipart Form field | **meta JSON 안 `autoNsfw`/`nsfwIntensity` 키** · 기존 패턴 (`adult`, `lightning` 등) 일관 · `video.ts:60-75` form.append("meta", JSON.stringify({...})) |
| 2 | 빈 prompt 차단 4곳 (**High**) | "텍스트 한 줄 안 적어도" 가정 | **4곳 모두 `autoNsfw=true` 일 때 prompt 검증 우회**: `VideoLeftPanel:130` ctaDisabled · `useVideoPipeline:66` toast · `streams.py:313` HTTP 400 · `upgrade.py:880` fallback |
| 3 | skipUpgrade 충돌 (**High**) | 미언급 | **`autoNsfw=true` → skipUpgrade 강제 OFF** + `preUpgradedPrompt` 미전송 (frontend) + backend 도 silent ignore (방어 다층) |
| 4 | history DB 경로 (**Medium**) | `history_db.py` + `ALTER TABLE videos` | **`history_db/schema.py` 패키지** + `history_db/items.py` 동시 수정 · 테이블명 `studio_history` |
| 5 | onReuse 설계 (**Medium**) | `useVideoStore.onReuse` + `settingsStore.setAdult` | **`onReuse` 메서드 없음** (현재 부재) — page/훅 레이어에서 `useVideoStore.setAdult` 직접 호출. `setAdult` 는 `useVideoStore` 에 있음 |
| 6 | KeyError 위험 (**High**) | `{same identity clause as ...}` 가 .format() 대상에 있음 | **format string 안 자리표시 제거** · 전체 clause 를 Python concat 으로 조립 (`+`) · format 은 intensity 라벨만 |
| 7 | L3 vocabulary 미완성 (**Medium**) | "All L2 vocabulary, plus" 문장만 | **코드 레벨 합치기**: `_AUTO_NSFW_L2_POOL + _AUTO_NSFW_L3_POOL_EXTRA` 로 분리 후 L3 block 에서 concat |
| 8 | temperature default (**High**) | "기존 default 0.4" — 실제는 0.6 | **`_call_ollama_chat default=0.6` 확인** · `_run_upgrade_call` 도 0.6 보존 · `autoNsfw=true` 일 때만 0.8 (variant 다양성 · 기존보다 약간 상향) |
| 9 | 비-인물 차단 deterministic 불가 (**Medium**) | "ANCHOR human subject 판정 라벨드 출력 포함" | **VIDEO_VISION_SYSTEM 은 자유 텍스트 5 labeled section** — 구조화 JSON 없음 · 코드 게이트 불가 · system clause 의 프롬프트 가이드만 best effort · §7.5 Known Limitation 으로 박제 |
| 10 | 테스트 카운트 산수 (**Low**) | "534 → 540 PASS (+6 신규)" | **변화량 표현**: "+7 신규 PASS (단위 6 + 통합 1) · 회귀 0" · spec 2026-05-11 v1.1 의 표현 방식 통일 |
| 11 | VideoAutoNsfwCard 테스트 (**Low**) | 카드 단위에서 "adult OFF 미렌더" | **VideoLeftPanel integration** 에서 "adult OFF 미렌더" · 카드 단위는 토글/슬라이더 동작만 (props 에 adult 없음) |
| 12 | 프레임 수 표기 (**Low**) | "16fps × 5s = 80 frame" | **81 frame** (Wan22 default_length=81 · 5초 + 1 보정 프레임) · timing pacing 설명 갱신 |

> Codex iterative review 패턴 (memory `feedback_codex_iterative_review.md`) 적용 — finding 12/12 모두 실제 코드와 대조 검증 후 수용. v1.1 반영 후 구현 단계 진행.

---

## 1. Context — 왜 이 변경이 필요한가

영상 모드 (`/video`) 의 성인 모드 (`adult=true`) 는 **사용자가 직접 영상 지시를 적어야** 동작. 토글만 켜고 끝나는 게 아니라 "옷 흘러내림" / "유혹적 자세" / "샤워" 같은 한국어 지시를 사용자가 일일이 입력해야 NSFW 시나리오가 만들어짐. AI 보강 (gemma4-un) 은 그 지시를 explicit 으로 확장만 함.

### 1.1 현재 흐름 (`backend/studio/video_pipeline.py:48` + `prompt_pipeline/upgrade.py:429`)

```
사용자: 이미지 업로드 + "옷 흘러내림" 입력 + adult ON
  → /video multipart (image + meta JSON)
  → run_video_pipeline
     → _describe_image (qwen3-vl · VIDEO_VISION_SYSTEM · ANCHOR/MOTION/...)
     → upgrade_video_prompt
        → build_system_video(adult=True, model_id="wan22")
           = SYSTEM_VIDEO_WAN22_BASE + SYSTEM_VIDEO_ADULT_CLAUSE + RULES
        → gemma4-un (사용자 지시 + image_description → explicit paragraph)
```

### 1.2 현재 흐름에서 빈 prompt 차단 4곳 (Codex Finding 2)

```
frontend:
  VideoLeftPanel.tsx:130   ctaDisabled = running || !sourceImage || !prompt.trim()
  useVideoPipeline.ts:66   if (!prompt.trim()) { toast.warn("영상 지시를..."); return; }

backend:
  routes/streams.py:313    if not prompt: raise HTTPException(400, "prompt required")
  prompt_pipeline/upgrade.py:880
                           if not user_direction.strip():
                               return UpgradeResult(fallback=True, ...)
```

자동 NSFW 모드를 도입하려면 **autoNsfw=true 일 때 이 4곳 모두 prompt 검증을 우회** 해야 함. 우회 안 하면 자동 시나리오 모드의 핵심 가치 (지시 없이 토글만으로 동작) 가 무너짐.

### 1.3 사용자 명시 의도 (브레인스토밍 발화 인용)

> "성인모드 ON 일 경우 비전 + gemma4-un 이 알아서 이미지를 야하게 (누드, 옷벗음 등) 프롬프팅하는 기능. 지금은 사용자가 간단지시 + AI 보강 하는데."

→ 사용자가 텍스트 한 줄 안 적어도 vision 의 의상/피사체 정보를 기반으로 gemma4 가 explicit 시나리오를 **자율 생성**. adult 토글이 1-click NSFW 의도라면 자동 시나리오는 그 위에 **1-click 시나리오 자율 작성**.

### 1.4 skipUpgrade 와의 충돌 (Codex Finding 3)

`useVideoStore.ts:163` 의 `skipUpgrade: true` 가 현재 default. skipUpgrade=true 면 `preUpgradedPrompt: req.preUpgradedPrompt` 가 meta 에 전송되어 backend 가 vision + gemma4 를 **통째로 우회** (`video.py:97`). 이 상태에서 autoNsfw=true 를 켜도 자동 시나리오 발동 불가.

→ **autoNsfw=true 일 때 skipUpgrade 강제 OFF + preUpgradedPrompt 미전송**. UI 에서도 자동 NSFW ON 일 때 skipUpgrade 토글 disabled + 시각 표시.

---

## 2. Scope — 무엇을 만들고 무엇을 안 만드는가

### 2.1 In Scope

**Backend** (6항목):
1. `routes/streams.py` POST /video — `meta` JSON 에서 `autoNsfw: bool`, `nsfwIntensity: int (1|2|3)` 두 키 읽기 + validation (adult 요구, intensity ∈ {1,2,3})
2. `routes/streams.py:313` `if not prompt` 검증 — `autoNsfw=True` 일 때 우회 (빈 prompt 허용)
3. `pipelines/video.py` `_run_video_pipeline_task` 시그니처 확장 (autoNsfw, nsfwIntensity keyword-only)
4. `video_pipeline.py` `run_video_pipeline` 시그니처 확장 + `upgrade.py:880` `if not user_direction.strip()` 검증을 `autoNsfw=True` 일 때 우회
5. `prompt_pipeline/upgrade.py`:
   - `upgrade_video_prompt` 시그니처 확장 (autoNsfw, nsfwIntensity)
   - `build_system_video` 시그니처 확장 (autoNsfw, intensity keyword-only)
   - `SYSTEM_VIDEO_AUTO_NSFW_CLAUSE_*` 신규 (KeyError 회피 concat 구조)
   - `_AUTO_NSFW_L{1,2,3}_POOL` 신규 (L3 = L2 + extra concat)
   - `_run_upgrade_call` 에 `temperature: float = 0.6` keyword-only 추가 + autoNsfw 일 때만 0.8 override
6. `history_db/schema.py` + `history_db/items.py` — `studio_history` 테이블에 `auto_nsfw INTEGER DEFAULT 0`, `nsfw_intensity INTEGER` 컬럼 추가 + items.py save/restore 동시 수정

**Frontend** (5항목):
7. `useSettingsStore` persist 에 `autoNsfwEnabled: boolean (false)`, `nsfwIntensity: 1|2|3 (default 2)` 추가
8. `components/studio/video/VideoAutoNsfwCard.tsx` 신규 (토글 + 슬라이더 · adult prop 없음 — 호출자가 conditional 렌더)
9. `VideoLeftPanel.tsx`:
   - 카드 통합 (adult ON 일 때 AnimatePresence 로 노출)
   - `ctaDisabled` 분기: `autoNsfwEnabled` 일 때 `!prompt.trim()` 조건 제거
   - skipUpgrade 토글 disabled + "자동 NSFW 모드 ON 시 항상 보강" 시각 안내 (autoNsfwEnabled 일 때)
10. `useVideoPipeline` (`hooks/useVideoPipeline.ts`):
    - 빈 prompt toast 분기: `if (!autoNsfwEnabled && !prompt.trim())` 로 조건 추가
    - `lib/api/video.ts` 호출 인자에 `autoNsfw`, `nsfwIntensity` 전달
    - skipUpgrade 강제 OFF (`autoNsfwEnabled && skipUpgrade` 면 skipUpgrade 무시)
11. `lib/api/video.ts` — `meta` JSON 객체에 `autoNsfw`, `nsfwIntensity` 키 추가 (조건부 — adult && autoNsfwEnabled 일 때만)
12. (조정) `VideoRequest` 타입 (`lib/api/types.ts`) 에 `autoNsfw?: boolean`, `nsfwIntensity?: 1|2|3` 필드 추가
13. (조정) 히스토리 onReuse 복원 — `app/video/page.tsx` 또는 `useVideoPipeline.onReuse` 에 신규 메서드 추가하여 `useVideoStore.setAdult` + `useSettingsStore.setAutoNsfwEnabled` 직접 호출

**Vision 단 변경 없음** — 기존 `VIDEO_VISION_SYSTEM` 의 5 labeled section 자유 텍스트가 의상 정보 일부 포함. 부족 시 후속 plan.

> Backend 6 + Frontend 5 (그중 #11, #12, #13 은 #10 의 자세한 분해) — 실제 변경 파일 수는 backend 4~6 + frontend 6~7.

### 2.2 Out of Scope (후속 plan 후보)

- **gemma4 응답 검증 Phase 2** (L1 출력에 "nude" / L2 에 "caress" 위반 → 재호출) — dogfooding 후 결정
- **Vision 시스템 구조화 출력** (자유 텍스트 → JSON schema) — Codex Finding 9 대응. 별도 spec
- **시나리오 type chip 선택 UI** (옵션 C — 옷벗기/topless/intimate touch 선택) — 강도 슬라이더로 충분 여부 dogfooding 후 결정
- **NSFW LoRA Wan 2.2 i2v 용** — 모델 자체 한계는 LoRA 영역
- **t2v 모드 / vision 없는 케이스** — 자동 시나리오는 i2v 전용
- **자동 시나리오 강도별 history pill 표시** — UI 노이즈 회피

---

## 3. Architecture

### 3.1 데이터 흐름 (Backend)

```
Frontend meta JSON:
  {
    "prompt": "" 또는 사용자 양념,
    "adult": true,
    "autoNsfw": true,
    "nsfwIntensity": 2,
    "lightning": true,
    "modelId": "wan22",
    ... (preUpgradedPrompt 미전송)
  }
       │
       ▼
routes/streams.py POST /video
  ├─ auto_nsfw = bool(meta_obj.get("autoNsfw"))
  ├─ nsfw_intensity = int(meta_obj.get("nsfwIntensity", 2))
  ├─ adult = bool(meta_obj.get("adult"))
  ├─ prompt = meta_obj.get("prompt", "").strip()
  ├─ if auto_nsfw and not adult → HTTPException(400)
  ├─ if auto_nsfw and nsfw_intensity not in {1,2,3} → HTTPException(400)
  ├─ if not prompt and not auto_nsfw → HTTPException(400 "prompt required")
  │  (auto_nsfw=true 일 때 빈 prompt 허용)
  └─ asyncio.create_task(_run_video_pipeline_task(..., auto_nsfw, nsfw_intensity))
       │
       ▼
pipelines/video.py _run_video_pipeline_task
  └─ run_video_pipeline(..., auto_nsfw, nsfw_intensity)
       │
       ▼
video_pipeline.py run_video_pipeline
  ├─ _describe_image(VIDEO_VISION_SYSTEM)  # unchanged
  ├─ ollama_unload
  └─ upgrade_video_prompt(..., auto_nsfw, nsfw_intensity)
       │
       ▼
prompt_pipeline/upgrade.py upgrade_video_prompt
  ├─ if not user_direction.strip() and not auto_nsfw → fallback (기존)
  ├─ if not user_direction.strip() and auto_nsfw → user_msg 에 빈 direction 으로
  │    "[User direction]\n(none — auto NSFW mode)" 로 표기
  └─ build_system_video(adult=True, model_id="wan22",
                         auto_nsfw=True, intensity=2)
       │
       ▼
build_system_video 분기:
  ┌──────────────────────────────────────────────────┐
  │ if auto_nsfw and adult:                          │
  │   adult_section = build_auto_nsfw_clause(        │
  │     intensity                                    │
  │   )                                              │
  │ elif adult:                                      │
  │   adult_section = SYSTEM_VIDEO_ADULT_CLAUSE      │
  │ else:                                            │
  │   adult_section = ""                             │
  │                                                  │
  │ return base + adult_section + RULES              │
  └──────────────────────────────────────────────────┘
       │
       ▼
_run_upgrade_call (auto_nsfw=True 면 temperature=0.8, 아니면 0.6 default)
  → gemma4-un → final_prompt = AI 자율 NSFW 시나리오 paragraph
       │
       ▼
build_video_from_request → ComfyUI dispatch → 5초 영상
       │
       ▼
history_db/items.py save_item
  → studio_history INSERT (auto_nsfw=1, nsfw_intensity=2)
```

**핵심 invariant**:
- adult=False → autoNsfw 무시 (validation 차단)
- autoNsfw=False → 기존 흐름 byte-identical (clause 미주입, prompt required 유지)
- autoNsfw=True → skipUpgrade 미전송 (frontend) + 빈 prompt 허용 (4곳 우회)

### 3.2 데이터 흐름 (Frontend)

```
useSettingsStore (persist):
  autoNsfwEnabled: false, nsfwIntensity: 2 (default = 옷벗음)
       │
       ▼
VideoLeftPanel:
  ├─ adult 토글 (기존 · useVideoStore.adult)
  ├─ ctaDisabled = running || !sourceImage
  │              || (!autoNsfwEnabled && !prompt.trim())
  ├─ skipUpgrade 토글:
  │   ├─ autoNsfwEnabled === false: 기존 그대로
  │   └─ autoNsfwEnabled === true: disabled + "자동 NSFW 모드는 항상 AI 보강" 안내
  └─ adult ON 일 때 AnimatePresence collapse:
       └─ VideoAutoNsfwCard:
            ├─ 🤖 자동 NSFW 시나리오 토글
            └─ autoNsfw ON 일 때 AnimatePresence:
                 └─ 강도 슬라이더 (1: 은근 / 2: 옷벗음 / 3: 옷벗음+애무)
       │
       ▼
useVideoPipeline (handleGenerate):
  ├─ if (!autoNsfwEnabled && !prompt.trim()) { toast.warn(...); return; }
  └─ const effectiveSkipUpgrade = autoNsfwEnabled ? false : skipUpgrade;
       │
       ▼
videoImageStream(req):
  req = {
    sourceImage, prompt, adult,
    autoNsfw: adult && autoNsfwEnabled ? true : undefined,
    nsfwIntensity: adult && autoNsfwEnabled ? nsfwIntensity : undefined,
    preUpgradedPrompt: effectiveSkipUpgrade ? upgradedPrompt : undefined,
    ...
  }
       │
       ▼
lib/api/video.ts realVideoStream:
  form.append("meta", JSON.stringify({
    prompt: req.prompt,
    adult: req.adult ?? false,
    autoNsfw: req.autoNsfw,           // NEW
    nsfwIntensity: req.nsfwIntensity, // NEW
    lightning, longerEdge, ...,
    preUpgradedPrompt: req.preUpgradedPrompt,
  }));
```

---

## 4. Component Design

### 4.1 Backend — Auto NSFW vocabulary pools (KeyError 회피 구조)

위치: `backend/studio/prompt_pipeline/upgrade.py` (기존 `SYSTEM_VIDEO_ADULT_CLAUSE` 바로 아래).

**구조 원칙** (Codex Finding 6 + 7 대응):
- format string 에 자리표시 **없음** — Python concat 으로 전체 clause 조립
- L3 pool 은 L2 pool 을 코드 레벨로 concat (`+`) — 텍스트 안 "All L2 vocabulary, plus" 표현 제거

```python
# ══════════════════════════════════════════════════════════════════════
# Auto NSFW 시나리오 vocabulary pools (spec 2026-05-12 v1.1)
# ══════════════════════════════════════════════════════════════════════
# 강도 3단:
#   L1 SUGGESTIVE — 옷 유지, 자세/표정/암시만
#   L2 UNDRESS    — 탈의 reveal 까지. 자기 손길 NO
#   L3 UNDRESS + INTIMATE — L2 + 누드 후 self-caress / 애무
#
# Codex Finding 6: format string 자리표시 위험 → 전체 concat 으로 조립
# Codex Finding 7: L3 = L2 + extra 코드 레벨 합치기

_AUTO_NSFW_L1_POOL = """
- Pose: arched back, hip sway, chest thrust forward, kneeling pose,
  leaning forward to deepen cleavage, slow leg crossing
- Hands: hands sliding down body, fingers tracing collarbone,
  self-caress over clothes, gripping fabric tightly
- Expression: half-lidded eyes, parted lips, slow lip bite,
  sultry gaze, flushed cheeks, breathy mouth
- Clothing interaction: pulling neckline lower, tugging waistband,
  fabric slipping briefly without exposing skin
"""

_AUTO_NSFW_L2_POOL = """
- Undress motion: slowly unzipping, unbuttoning top button by button,
  sliding straps off shoulders, pulling dress down past chest,
  pulling top over head, stepping out of skirt,
  dropping garment to floor, peeling off lingerie
- Reveal result: fully topless, completely nude, garments removed,
  no clothing remaining, bare body revealed
- Expression: sultry, slow deliberate pace, confident reveal
"""

# Codex Finding 7: L3 extra 만 따로 정의 → L3 block 에서 L2_POOL + L3_EXTRA concat
_AUTO_NSFW_L3_POOL_EXTRA = """
- Post-nude motion: hands cupping bare breasts, fingers tracing
  nude skin, self-caress over bare body, nude hips grinding,
  arched back while nude, naked body writhing slowly,
  squeezing own thighs, sliding hand down stomach,
  touching collarbone and down chest
- Camera: intimate close-up of bare skin, slow pan over nude body,
  focus on touching hand
"""

# ── 강도별 block 본문 ──
def _intensity_block_l1() -> str:
    return (
        "Compose a clip where the subject performs seductive posing and\n"
        "clothing interaction WITHOUT removing any garments. 5 seconds of\n"
        "arched back / hip sway / sultry gaze / fabric play. Use ONLY the\n"
        "L1 vocabulary below. The clip must NOT contain nudity, topless\n"
        "reveal, or garment removal.\n\n"
        "L1 vocabulary:"
        + _AUTO_NSFW_L1_POOL
    )

def _intensity_block_l2() -> str:
    return (
        "Compose a clip where the subject removes their clothing during the\n"
        "5-second window OR starts the clip already mid-undress. The clip\n"
        "ENDS at full reveal. CRITICAL NEGATIVE RULES:\n"
        "- NO self-caress after nudity\n"
        "- NO hand-on-body touching after reveal\n"
        "- NO hip grinding or arched-back motion after reveal\n"
        "The camera may linger on the bare body but the body itself stays\n"
        "still or only breathes naturally. The reveal IS the climax.\n\n"
        "L2 vocabulary:"
        + _AUTO_NSFW_L2_POOL
    )

def _intensity_block_l3() -> str:
    return (
        "Compose a clip that combines undress with intimate self-touch\n"
        "AFTER reveal. The first ~half of the clip is undress (~2.5 seconds);\n"
        "the latter ~half is nude self-caress / arched back / hip motion /\n"
        "hand-on-body. Pacing matters — do not skip the undress phase.\n\n"
        "Combined vocabulary (L2 + L3):"
        + _AUTO_NSFW_L2_POOL
        + _AUTO_NSFW_L3_POOL_EXTRA
    )

_INTENSITY_BLOCK_FACTORY = {
    1: _intensity_block_l1,
    2: _intensity_block_l2,
    3: _intensity_block_l3,
}

# ── 자동 NSFW clause 조립 (format string 없음 — 전체 concat) ──
# Codex Finding 6: identity clause 같은 {} 자리표시를 절대 안 씀
# 정체성 절은 build_system_video 가 base 안에 이미 명시 (model_id 분기에서).
# AUTO_NSFW_CLAUSE 는 base 위에 덧붙는 추가 directives 만 담음.
_AUTO_NSFW_CLAUSE_PREAMBLE = """

AUTO NSFW MODE (intensity L{intensity_label} — uncensored · explicit allowed):
The user may NOT have written a primary direction (or only a brief side-note).
Your job: INVENT an explicit scenario grounded in the ANCHOR (subject,
outfit, setting) from the image analysis.

Steps:
1. Identify what the subject is wearing in ANCHOR (dress / shirt /
   swimsuit / lingerie / casual / sportswear / etc.).
2. Choose action narrative appropriate to the intensity level below.
3. Ground every action in the visible outfit — if subject wears a
   dress, the dress is the garment that slips. If a bikini, the
   bikini straps. NEVER invent garments not in ANCHOR.

INTENSITY:
"""

_AUTO_NSFW_CLAUSE_GRAFTING = """

USER DIRECTION GRAFTING:
If user_direction is non-empty, weave it as a SECONDARY detail
(e.g. "샤워 배경" → "in a steamy shower setting", "키스" → "leaning
in for a slow kiss"). The auto NSFW action remains the PRIMARY
narrative. Do NOT let user_direction override the intensity level.
If user_direction is empty, derive the entire scenario from the
image analysis alone.

NON-HUMAN SUBJECT FALLBACK:
If ANCHOR describes a landscape / object / non-human subject (no
person), SKIP the auto NSFW directives above and fall back to the
user_direction only. Do not invent human nudity on top of non-human
scenes.
"""


def build_auto_nsfw_clause(intensity: int) -> str:
    """L{1|2|3} 분기 + grafting/fallback rule + preamble 조립.

    format string 의 단일 자리표시 ({intensity_label}) 는 한 자리만 받음 —
    KeyError 방지 위해 다른 {} 는 절대 안 둠. block 본문은 별도 함수가
    완성된 문자열을 반환 (function call 결과를 concat).
    """
    if intensity not in (1, 2, 3):
        raise ValueError(f"intensity must be 1|2|3, got {intensity}")
    preamble = _AUTO_NSFW_CLAUSE_PREAMBLE.format(intensity_label=intensity)
    block = _INTENSITY_BLOCK_FACTORY[intensity]()
    return preamble + block + _AUTO_NSFW_CLAUSE_GRAFTING
```

**왜 이 구조** (Codex Finding 6 fix):
- preamble 안 `{intensity_label}` 단일 자리만 format 사용 → KeyError 위험 0
- 본문 block 들은 raw Python string + concat → format 안 거침
- identity clause 는 별도 변수 안 둠 — base prompt (`SYSTEM_VIDEO_WAN22_BASE` / `SYSTEM_VIDEO_BASE`) 안에 이미 identity preservation 명시되어 있음 (spec 2026-05-11 v1.1 § 4.1 참조)

**왜 L3 concat** (Codex Finding 7 fix):
- v1.0 의 "All L2 vocabulary, plus" 문자열만으로는 gemma4 가 L2 어휘를 실제로 받지 못함
- `_AUTO_NSFW_L2_POOL + _AUTO_NSFW_L3_POOL_EXTRA` 코드 레벨 concat → L3 block 안에 L2 + L3 어휘 둘 다 명시 전달

### 4.2 Backend — `build_system_video()` 시그니처 확장

```python
def build_system_video(
    *,
    adult: bool,
    model_id: str,
    auto_nsfw: bool = False,
    intensity: int = 2,
) -> str:
    """Video 시스템 프롬프트 구성 (spec 2026-05-12 v1.1).

    - auto_nsfw=False (default): 기존 동작 그대로 (adult 분기 + adult clause)
    - auto_nsfw=True: adult clause 대체 → build_auto_nsfw_clause(intensity)
      · auto_nsfw=True 인데 adult=False 면 ValueError (validation 은 routes
        레이어 책임 · 여기선 fail-fast 다층 방어)
    """
    if auto_nsfw and not adult:
        raise ValueError("auto_nsfw requires adult=True")
    if auto_nsfw and intensity not in (1, 2, 3):
        raise ValueError(f"intensity must be 1|2|3, got {intensity}")

    if model_id == "wan22":
        base = SYSTEM_VIDEO_WAN22_BASE
    elif model_id == "ltx":
        base = SYSTEM_VIDEO_BASE
    else:
        raise ValueError(f"unknown video model_id: {model_id!r}")

    if auto_nsfw:
        adult_section = build_auto_nsfw_clause(intensity)
    elif adult:
        adult_section = SYSTEM_VIDEO_ADULT_CLAUSE
    else:
        adult_section = ""

    return base + adult_section + SYSTEM_VIDEO_RULES
```

**키워드-only required**: 기존 `model_id` 패턴 (spec 2026-05-11 v1.1) 과 일관. `auto_nsfw` / `intensity` 도 keyword-only.

### 4.3 Backend — `upgrade_video_prompt()` 시그니처 확장 + temperature override

```python
async def upgrade_video_prompt(
    user_direction: str,
    image_description: str,
    *,
    model_id: str,
    auto_nsfw: bool = False,        # NEW
    nsfw_intensity: int = 2,         # NEW
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
    adult: bool = False,
    prompt_mode: PromptEnhanceMode | str | None = "fast",
) -> UpgradeResult:
    """spec 2026-05-12 v1.1 · auto_nsfw + nsfw_intensity 키워드-only 추가.

    auto_nsfw=True 일 때 변경 사항:
      - build_system_video(auto_nsfw=True, intensity=nsfw_intensity)
      - temperature=0.8 (variant 다양성 확보)
      - 빈 user_direction 허용 (4곳 fallback 우회) — user_msg 에 "(none — auto NSFW mode)" 표기
    """
    # Codex Finding 2: auto_nsfw=True 면 빈 user_direction 허용
    if not user_direction.strip() and not auto_nsfw:
        return UpgradeResult(
            upgraded=user_direction,
            fallback=True,
            provider="fallback",
            original=user_direction,
        )

    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    direction_label = (
        user_direction.strip() if user_direction.strip()
        else "(none — auto NSFW mode · synthesize entirely from ANCHOR)"
    )
    user_msg = (
        f"[Image description]\n{image_description.strip()}\n\n"
        f"[User direction]\n{direction_label}"
    )

    return await _run_upgrade_call(
        system=build_system_video(
            adult=adult,
            model_id=model_id,
            auto_nsfw=auto_nsfw,
            intensity=nsfw_intensity,
        ),
        user_msg=user_msg,
        original=user_direction,
        model=model,
        timeout=timeout,
        resolved_url=resolved_url,
        include_translation=include_translation,
        # Codex Finding 8: 기존 default 0.6 보존 · auto_nsfw 일 때만 0.8
        temperature=0.8 if auto_nsfw else 0.6,
        # prompt_mode 그대로
        prompt_mode=prompt_mode,
    )
```

**temperature 0.6 → 0.8 (자동 시나리오만)** (Codex Finding 8 fix):
- 실제 `_call_ollama_chat default = 0.6` 확인됨 (`_ollama.py:28`)
- 기존 0.4 가정은 틀렸음 → 0.6 보존
- 자동 시나리오는 variant 다양성 필요 → 0.8 (0.6 보다 약간 상향 · 너무 높이면 hallucination 위험)
- `_run_upgrade_call` 시그니처에 `temperature: float = 0.6` keyword-only 추가 (기존 default 보존) — 호출자만 명시 override

### 4.4 Backend — `run_video_pipeline()` + `_run_video_pipeline_task()` 시그니처 확장

```python
# video_pipeline.py
async def run_video_pipeline(
    image_path: Path | str | bytes,
    user_direction: str,
    *,
    model_id: str,
    vision_model: str | None = None,
    text_model: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    adult: bool = False,
    auto_nsfw: bool = False,            # NEW
    nsfw_intensity: int = 2,             # NEW
    prompt_mode: str = "fast",
) -> VideoPipelineResult:
    ...
    upgrade = await upgrade_video_prompt(
        user_direction=user_direction,
        image_description=description,
        model_id=model_id,
        adult=adult,
        auto_nsfw=auto_nsfw,
        nsfw_intensity=nsfw_intensity,
        ...
    )
    ...
```

`pipelines/video.py` 의 `_run_video_pipeline_task` 도 동일 패턴으로 두 kwarg 추가.

### 4.5 Backend — `routes/streams.py` `/video` 엔드포인트 (meta JSON 파싱)

`routes/streams.py:301` 의 `create_video_task` 본체에서:

```python
# meta JSON 파싱 영역 (기존 311 라인 근처)
prompt = meta_obj.get("prompt", "").strip()
adult = bool(meta_obj.get("adult", False))
# NEW (spec 2026-05-12 v1.1)
auto_nsfw = bool(meta_obj.get("autoNsfw", False))
nsfw_intensity_raw = meta_obj.get("nsfwIntensity", 2)
try:
    nsfw_intensity = int(nsfw_intensity_raw)
except (TypeError, ValueError):
    raise HTTPException(400, "nsfwIntensity must be an integer")

# validation 매트릭스 (spec 2026-05-12 v1.1 §5.1)
if auto_nsfw and not adult:
    raise HTTPException(400, "autoNsfw requires adult=true")
if auto_nsfw and nsfw_intensity not in (1, 2, 3):
    raise HTTPException(400, "nsfwIntensity must be 1|2|3")

# Codex Finding 2: prompt required 검증 우회 (auto_nsfw 일 때 빈 prompt 허용)
if not prompt and not auto_nsfw:
    raise HTTPException(400, "prompt required")

# Codex Finding 3 (방어 다층): auto_nsfw=true 면 preUpgradedPrompt 무시
pre_upgraded = meta_obj.get("preUpgradedPrompt")
if auto_nsfw:
    pre_upgraded = None  # silent ignore

asyncio.create_task(
    _run_video_pipeline_task(
        ...,
        adult=adult,
        auto_nsfw=auto_nsfw,             # NEW
        nsfw_intensity=nsfw_intensity,   # NEW
        pre_upgraded_prompt=pre_upgraded,
        ...
    )
)
```

### 4.6 Backend — `history_db/schema.py` + `items.py` migration (Codex Finding 4)

**위치**: `backend/studio/history_db/` 패키지 (`history_db.py` 단일 파일 아님)

**schema.py**:
- `SCHEMA_VERSION` 9 → 10 bump
- `studio_history` 테이블에 2 컬럼 추가:
  ```sql
  ALTER TABLE studio_history ADD COLUMN auto_nsfw INTEGER DEFAULT 0;
  ALTER TABLE studio_history ADD COLUMN nsfw_intensity INTEGER;
  ```
- migration step 1개 추가 (v9 → v10)

**items.py**:
- `save_item` (또는 _persist_history 호출 site) — `mode == "video"` 일 때 `auto_nsfw`, `nsfw_intensity` 컬럼에 값 INSERT
- `row_to_item` (또는 row dict 변환 site) — 두 컬럼 읽기 + dict key `autoNsfw`, `nsfwIntensity` 로 변환
- 기존 row 의 `auto_nsfw` 는 DEFAULT 0 → false 자연 복원 · `nsfw_intensity` 는 NULL → onReuse 시 store default 2 사용

### 4.7 Frontend — `useSettingsStore` persist 확장

```ts
// stores/useSettingsStore.ts
type NsfwIntensity = 1 | 2 | 3;

interface SettingsStore {
  ...
  autoNsfwEnabled: boolean;       // default false · persist
  nsfwIntensity: NsfwIntensity;   // default 2 (옷벗음) · persist
  setAutoNsfwEnabled: (v: boolean) => void;
  setNsfwIntensity: (v: NsfwIntensity) => void;
}
```

**디폴트 강도 = 2 (옷벗음)** — 사용자 확정 (브레인스토밍 Q1).

### 4.8 Frontend — `VideoAutoNsfwCard.tsx` 신규

위치: `frontend/components/studio/video/VideoAutoNsfwCard.tsx`.

**Props** (Codex Finding 11 — adult prop 없음, 호출자가 conditional 렌더):
```ts
interface VideoAutoNsfwCardProps {
  autoNsfwEnabled: boolean;
  nsfwIntensity: 1 | 2 | 3;
  onToggle: (v: boolean) => void;
  onIntensityChange: (v: 1 | 2 | 3) => void;
}
```

**UI**:
```text
┌─ 🤖 자동 NSFW 시나리오 ───────────────────┐
│  [토글 OFF/ON]                                │
│  설명: "AI 가 이미지를 보고 알아서           │
│  시나리오 작성 (지시 비워도 OK)"             │
│                                                 │
│  ▼ ON 일 때 AnimatePresence collapse-in       │
│  ┌─ 강도 ────────────────────────────────┐ │
│  │  ●━━━━━━━━━━━○━━━━━━━━━━━○           │ │
│  │  은근     옷벗음     옷벗음+애무         │ │
│  │  (L1)      (L2)         (L3)            │ │
│  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**의존성**: framer-motion `AnimatePresence`. 슬라이더는 `<input type="range" min={1} max={3} step={1}>` 위에 한국어 라벨 3개 absolute 배치.

**왜 분리 컴포넌트**: `VideoLeftPanel.tsx` 현재 371줄 — Codex Finding 6 (VideoResolutionCard 분리) 패턴 적용.

### 4.9 Frontend — `VideoLeftPanel.tsx` 통합 + ctaDisabled 분기 + skipUpgrade 가드

기존 adult 토글 블록 아래에 conditional 삽입:

```tsx
<AdultToggle ... />

<AnimatePresence>
  {adult && (
    <motion.div initial={...} animate={...} exit={...}>
      <VideoAutoNsfwCard
        autoNsfwEnabled={autoNsfwEnabled}
        nsfwIntensity={nsfwIntensity}
        onToggle={setAutoNsfwEnabled}
        onIntensityChange={setNsfwIntensity}
      />
    </motion.div>
  )}
</AnimatePresence>
```

**ctaDisabled 분기** (Codex Finding 2):
```tsx
// 기존: const ctaDisabled = running || !sourceImage || !prompt.trim();
// 변경:
const promptRequired = !autoNsfwEnabled;
const ctaDisabled = running || !sourceImage || (promptRequired && !prompt.trim());
```

**skipUpgrade 토글 가드** (Codex Finding 3):
```tsx
<SkipUpgradeToggle
  value={skipUpgrade}
  onChange={setSkipUpgrade}
  disabled={autoNsfwEnabled}
  helperText={
    autoNsfwEnabled
      ? "자동 NSFW 모드는 항상 AI 보강을 사용합니다"
      : undefined
  }
/>
```

(`SkipUpgradeToggle` 컴포넌트 단독 분리는 별도 — 기존 inline 구조 그대로 두고 disabled prop + helperText conditional 추가만)

**숨김/노출 정책 매트릭스**:

| state | autoNsfw 토글 | 강도 슬라이더 | ctaDisabled 조건 | skipUpgrade |
|-------|---------------|----------------|--------------------|---------------|
| adult OFF | 숨김 | 숨김 | `!prompt.trim()` | enabled |
| adult ON · auto OFF | 노출 (off) | 숨김 | `!prompt.trim()` | enabled |
| adult ON · auto ON | 노출 (on) | 노출 | (prompt 검증 X) | disabled · 시각 안내 |

### 4.10 Frontend — `useVideoPipeline` (handleGenerate)

```ts
// hooks/useVideoPipeline.ts
const handleGenerate = useCallback(async () => {
  if (!sourceImage) { toast.warn("이미지를 먼저..."); return; }

  // Codex Finding 2: 빈 prompt toast 분기 (autoNsfwEnabled 일 때 우회)
  if (!autoNsfwEnabled && !prompt.trim()) {
    toast.warn("영상 지시를 입력해 주세요.");
    return;
  }

  // Codex Finding 3: autoNsfwEnabled 면 skipUpgrade 강제 OFF
  const effectiveSkipUpgrade = autoNsfwEnabled ? false : skipUpgrade;
  const preUpgradedPrompt = effectiveSkipUpgrade ? upgradedPromptCache : undefined;

  for await (const stage of videoImageStream({
    sourceImage,
    prompt,
    adult,
    autoNsfw: adult && autoNsfwEnabled ? true : undefined,
    nsfwIntensity: adult && autoNsfwEnabled ? nsfwIntensity : undefined,
    preUpgradedPrompt,
    lightning,
    longerEdge,
    modelId: selectedVideoModel,
    ollamaModel, visionModel,
    promptMode,
  })) {
    ...
  }
}, [
  sourceImage, prompt, adult,
  autoNsfwEnabled, nsfwIntensity,
  skipUpgrade, upgradedPromptCache,
  lightning, longerEdge, selectedVideoModel,
  ollamaModel, visionModel, promptMode,
]);
```

**핵심 게이트**:
- `adult && autoNsfwEnabled` 단일 게이트 — race condition 차단
- `effectiveSkipUpgrade` 로 preUpgradedPrompt 전송 여부 결정 (autoNsfw 일 때 항상 vision/gemma4 호출)

### 4.11 Frontend — `lib/api/video.ts` meta JSON 확장

```ts
// lib/api/video.ts:60-75 영역
form.append(
  "meta",
  JSON.stringify({
    prompt: req.prompt,
    adult: req.adult ?? false,
    autoNsfw: req.autoNsfw,           // NEW · undefined 면 backend 가 default false
    nsfwIntensity: req.nsfwIntensity, // NEW · undefined 면 backend 가 default 2 (autoNsfw=false 일 때 무시)
    lightning: req.lightning ?? true,
    longerEdge: req.longerEdge,
    ollamaModel: req.ollamaModel,
    visionModel: req.visionModel,
    preUpgradedPrompt: req.preUpgradedPrompt,
    promptMode: req.promptMode,
    modelId: req.modelId,
  }),
);
```

**VideoRequest 타입** (`lib/api/types.ts`) 에 두 필드 추가:
```ts
interface VideoRequest {
  ...
  autoNsfw?: boolean;
  nsfwIntensity?: 1 | 2 | 3;
}
```

OpenAPI 자동 생성 (`generated.ts`) 도 백엔드 schema 변경 후 `npm run gen:types` 로 동기화 — 단 meta JSON 안 필드는 OpenAPI 가 추적 못함 (FastAPI 의 meta 가 string 인자라). `types.ts` 손편집 유지.

### 4.12 Frontend — onReuse 히스토리 복원 (Codex Finding 5)

**기존 onReuse 메서드 없음** 확인됨. `app/video/page.tsx` 의 `handleGenerate` 시점이 아닌 **히스토리 타일 클릭 시점**에 복원이 필요.

복원 위치 후보 2개:
1. `app/video/page.tsx` 에 `onReuse(item: HistoryItem)` handler 신규 — `HistoryGallery` props 에 전달
2. `hooks/useVideoPipeline.ts` 에 `reuse(item)` 함수 신규 export

**선택**: 옵션 1 (page.tsx 에 handler) — 다른 페이지 (generate, edit) 와 일관. 다만 onReuse handler 가 store 직접 호출:

```ts
// app/video/page.tsx
const handleReuse = useCallback((item: HistoryItem) => {
  videoStore.setSource(item.imageRef, ...);
  videoStore.setPrompt(item.prompt);
  videoStore.setAdult(item.adult ?? false);
  videoStore.setLightning(item.lightning ?? true);

  // NEW (spec 2026-05-12)
  if (item.adult && item.autoNsfw) {
    settingsStore.setAutoNsfwEnabled(true);
    settingsStore.setNsfwIntensity(item.nsfwIntensity ?? 2);
  } else {
    settingsStore.setAutoNsfwEnabled(false);
    // nsfwIntensity 는 store default 유지 (별도 reset 안 함 — 사용자 선호 보존)
  }
}, [videoStore, settingsStore]);
```

**HistoryItem 타입** (`lib/api/types.ts`) 에 `autoNsfw?: boolean`, `nsfwIntensity?: 1 | 2 | 3` 두 옵셔널 필드 추가.

---

## 5. Error Handling & Edge Cases

### 5.1 Backend validation 매트릭스

| 입력 조합 | 결과 |
|-----------|------|
| `adult=false, autoNsfw=false, prompt=""` | **400** "prompt required" |
| `adult=false, autoNsfw=false, prompt="..."` | 정상 (기존 흐름) |
| `adult=true, autoNsfw=false, prompt=""` | **400** "prompt required" |
| `adult=true, autoNsfw=false, prompt="..."` | 정상 (기존 adult 흐름) |
| `adult=false, autoNsfw=true` | **400** "autoNsfw requires adult=true" |
| `adult=true, autoNsfw=true, intensity=0` | **400** "nsfwIntensity must be 1\|2\|3" |
| `adult=true, autoNsfw=true, intensity=4` | **400** "nsfwIntensity must be 1\|2\|3" |
| `adult=true, autoNsfw=true, intensity="abc"` | **400** "nsfwIntensity must be an integer" |
| `adult=true, autoNsfw=true, intensity=2, prompt=""` | **정상** (자동 시나리오 발동) |
| `adult=true, autoNsfw=true, intensity=2, prompt="샤워"` | **정상** (자동 + grafting "샤워") |
| `adult=true, autoNsfw=true, preUpgradedPrompt="..."` | **정상** (preUpgraded silent ignore + 자동 시나리오 발동) |

### 5.2 gemma4 응답 품질 변동

**문제**: gemma4 가 system clause 의 negative rule 을 100% 준수하지 못할 수 있음.
- L1 인데 출력에 "topless" / "nude" 가 섞임
- L2 인데 출력에 "self-caress" / "grinding" 이 섞임

**현재 대응**: system clause 의 명시 negative rule + temperature 0.8 (자동 시나리오만) 로 1차 방어. 강제 sanitize 안 함.

**Phase 2 후보** (§2.2 out of scope): 응답 키워드 grep → 위반 시 1회 재호출. dogfooding 후 위반 빈도 보고 결정.

### 5.3 Vision 분석 실패 시

기존 동작 그대로: `description = "(vision model unavailable...)"`. `auto_nsfw=True` 일 때도 동일 — vision 실패해도 gemma4 가 intensity clause 만으로 시도. 단 ANCHOR 없으면 "옷 종류" grounding 불가 → 결과 generic. 로깅으로만 표시.

### 5.4 비-인물 이미지 (Codex Finding 9)

**문제**: `VIDEO_VISION_SYSTEM` 출력이 자유 텍스트 5 labeled section — 구조화 JSON 아님. 코드 레벨에서 "ANCHOR 가 person 인지 판정" 불가.

**v1.1 대응**: best effort prompt 가이드 only.
- `_AUTO_NSFW_CLAUSE_GRAFTING` 안에 `NON-HUMAN SUBJECT FALLBACK` 섹션 명시 — gemma4 가 ANCHOR 를 읽고 사람 없으면 자동 NSFW directives 건너뛰고 user_direction 만 사용
- 코드 게이트 (예: ANCHOR 정규식 매칭) 는 **하지 않음** — 자유 텍스트 신뢰성 낮음
- dogfooding 검증 항목으로 추가 (§6.6 #7) — 풍경 이미지 + autoNsfw ON 시 NSFW 발동 안 하는지 사용자 확인

### 5.5 5초 timing pacing (특히 L3)

Wan 2.2 default_length = **81 frame** (16fps · 5초 + 1 보정 프레임). L3 는 "전반 옷벗음 (~2.5s · 40 frame) + 후반 애무 (~2.5s · 41 frame)" 라 시간 압박. gemma4 clause 에 "first ~half undress (~2.5s), latter ~half intimate" 명시.

### 5.6 LTX 2.3 와의 호환

LTX 2.3 (`model_id="ltx"`) 도 자동 NSFW 적용. `SYSTEM_VIDEO_BASE` (LTX cinematic) 위에 `build_auto_nsfw_clause(intensity)` 가 같은 방식으로 주입. LTX 는 `ltx2310eros_beta.safetensors` LoRA 가 시너지 좋아 결과 더 explicit. 회귀 0.

### 5.7 skipUpgrade 충돌 방어 다층 (Codex Finding 3)

- **Frontend Layer 1**: `useVideoPipeline.handleGenerate` 에서 `effectiveSkipUpgrade = autoNsfwEnabled ? false : skipUpgrade`
- **Frontend Layer 2**: `VideoLeftPanel` 의 skipUpgrade 토글 자체가 `disabled={autoNsfwEnabled}` — 사용자 UI 차단
- **Backend Layer 3**: `routes/streams.py` 에서 `auto_nsfw=True` 면 `pre_upgraded = None` 강제 (silent ignore)

3 단계 방어 — Frontend 우회 시도해도 backend 가 차단.

---

## 6. Testing Strategy

### 6.1 Backend pytest 신규 (단위 6 + 통합 1 = +7)

위치: `backend/tests/studio/test_video_pipeline.py` 확장.

**단위 6** (build_system_video / build_auto_nsfw_clause):

| # | 테스트 이름 | 검증 |
|---|-------------|------|
| 1 | `test_auto_nsfw_l1_clause_no_removal` | L1 clause 에 "WITHOUT removing any garments" + "NOT contain nudity, topless reveal, or garment removal" 명시 |
| 2 | `test_auto_nsfw_l2_no_caress_after_nudity` | L2 clause 에 "NO self-caress after nudity" + "reveal IS the climax" 명시 |
| 3 | `test_auto_nsfw_l3_combined_vocabulary` | L3 clause 에 L2 pool + L3 extra 모두 포함 (코드 레벨 concat 검증) — `_AUTO_NSFW_L2_POOL` 의 "Undress motion" + `_AUTO_NSFW_L3_POOL_EXTRA` 의 "Post-nude motion" 둘 다 substring 매칭 |
| 4 | `test_auto_nsfw_grafting_and_fallback` | clause 에 `USER DIRECTION GRAFTING` + `NON-HUMAN SUBJECT FALLBACK` 섹션 명시 |
| 5 | `test_auto_nsfw_requires_adult_value_error` | `build_system_video(adult=False, auto_nsfw=True)` 호출 시 ValueError |
| 6 | `test_auto_nsfw_invalid_intensity_value_error` | `intensity=0`, `intensity=4` 각각 ValueError |

**통합 1** (3단 전파):

| # | 테스트 이름 | 검증 |
|---|-------------|------|
| 7 | `test_auto_nsfw_e2e_propagation` | `_run_video_pipeline_task(auto_nsfw=True, nsfw_intensity=3)` 호출 시 mock gemma4 가 받는 system prompt 에 L3 combined vocabulary 포함 (3단 전파: task → pipeline → upgrade) |

### 6.2 Backend pytest 회귀 갱신 (기존 시그니처 default 유지)

| 테스트 | 변경 |
|--------|------|
| `test_build_system_video_adult` | `auto_nsfw=False` (default) 일 때 기존 `SYSTEM_VIDEO_ADULT_CLAUSE` 가 들어가는지 재확인 |
| `test_run_video_pipeline_basic` | `auto_nsfw=False` default 호환 (동작 byte-identical) |
| `test_upgrade_video_prompt_adult` | `auto_nsfw=False` default + temperature=0.6 (변경 없음) 확인 |

### 6.3 Backend HTTP validation 테스트 (3개)

위치: `backend/tests/studio/test_routes_video.py` (없으면 신규).

| # | 테스트 이름 | 검증 |
|---|-------------|------|
| 8 | `test_video_endpoint_auto_nsfw_requires_adult_400` | meta `{adult: false, autoNsfw: true}` → HTTP 400 |
| 9 | `test_video_endpoint_auto_nsfw_invalid_intensity_400` | meta `{adult: true, autoNsfw: true, nsfwIntensity: 0}` / `5` / `"abc"` → 모두 HTTP 400 |
| 10 | `test_video_endpoint_auto_nsfw_allows_empty_prompt` | meta `{adult: true, autoNsfw: true, nsfwIntensity: 2, prompt: ""}` → HTTP 200 (정상 task 생성) |

**Backend 신규 총 +10 (단위 6 + 통합 1 + HTTP 3) · 회귀 0**

### 6.4 Frontend vitest 신규 (3개)

| # | 테스트 이름 | 검증 |
|---|-------------|------|
| 1 | `VideoAutoNsfwCard.test.tsx` | 카드 단위 — 토글 클릭 → onToggle 콜백 / 슬라이더 변경 → onIntensityChange 콜백 / autoNsfwEnabled=false 일 때 슬라이더 미렌더 (props 기반 · adult prop 없음) |
| 2 | `useVideoPipeline.test.ts` | (a) `adult && autoNsfwEnabled` 일 때 `videoImageStream` 호출 인자에 `autoNsfw=true`, `nsfwIntensity` 포함 (b) `autoNsfwEnabled` 일 때 `preUpgradedPrompt` 미전송 (c) `autoNsfwEnabled && !prompt.trim()` 일 때 toast 없이 진행 |
| 3 | `useSettingsStore.test.ts` | `autoNsfwEnabled`, `nsfwIntensity` persist 직렬화/복구 (기본값 false / 2) |

**Codex Finding 11** — "adult OFF 미렌더" 는 카드 단위가 아니라 **VideoLeftPanel integration**.

### 6.5 Frontend vitest 통합 (1개 신규 또는 기존 확장)

위치: `frontend/__tests__/VideoLeftPanel.test.tsx` (있으면 확장).

| # | 테스트 이름 | 검증 |
|---|-------------|------|
| 4 | `VideoLeftPanel.integration.test.tsx` | adult OFF → `VideoAutoNsfwCard` 미렌더 / adult ON → 카드 노출 / autoNsfwEnabled ON → skipUpgrade 토글 disabled + helperText 표시 |

**Frontend 신규 총 +4 (단위 3 + 통합 1) · 회귀 0**

### 6.6 회귀 목표 (변화량 표현 · Codex Finding 10)

- **pytest**: +10 신규 PASS (단위 6 + 통합 1 + HTTP 3) · 회귀 0
- **vitest**: +4 신규 PASS (단위 3 + 통합 1) · 회귀 0
- **tsc / lint**: clean

### 6.7 Dogfooding 체크리스트 (구현 후 사용자 시각 검증)

| # | 시나리오 | 기대 |
|---|----------|------|
| 1 | 같은 인물 이미지 + L1 × 5 영상 | 옷 안 벗는지 / 자세·표정만 sultry · 결과 다양성 |
| 2 | L2 × 5 영상 | 옷 벗기 시퀀스 있는지 / 자기 손길 없는지 / reveal 에서 끝나는지 |
| 3 | L3 × 5 영상 | 옷 벗고 + intimate self-touch 있는지 |
| 4 | L1↔L2↔L3 시각 점진성 | 결과 명확히 구분되는지 |
| 5 | 자동 ON + 빈 prompt | 토스트 없이 정상 진행 + 자동 시나리오 발동 |
| 6 | 자동 ON + 양념 "샤워" | 메인은 옷벗음, 배경만 샤워인지 (grafting) |
| 7 | 풍경 이미지 + 자동 ON | NSFW 발동 안 하고 fallback 동작 (Codex Finding 9) |
| 8 | 자동 ON 상태에서 skipUpgrade 토글 | UI 에 disabled 표시 + 시각 안내 |
| 9 | 히스토리 onReuse | adult + autoNsfw + nsfwIntensity 복원 |

---

## 7. Known Limitations

### 7.1 Wan 2.2 i2v 모델 자체의 NSFW 묘사 한계

- Wan 2.2 학습 데이터 분포상 explicit 표현 부족 가능. 별도 검증된 NSFW LoRA 없음 (2026-05-12 기준)
- LTX 2.3 는 `ltx2310eros_beta.safetensors` LoRA 보유 → 시너지 우월
- dogfooding 시 "결과 약함" 발견되면 모델 한계인지 prompt 결함인지 구분 필요

### 7.2 5초 분량의 timing 한계

- Wan22 default_length = 81 frame (16fps · 5초 + 1)
- L3 (옷벗음 + 애무) 는 두 단계 압축 — 모델이 pacing 못 잡으면 어색한 점프 컷 가능

### 7.3 ANCHOR 의상 detail 부족

- 현재 `VIDEO_VISION_SYSTEM` 의 ANCHOR 가 의상 type 까지 잡지만 detail (소재 / 끈 위치 / 단추 개수) 약함
- "오른쪽 어깨 끈이 흘러내림" 같은 정확한 grounding 어려울 수 있음
- Vision 시스템 의상 detail 강화는 후속 plan (§2.2)

### 7.4 gemma4 응답 검증 부재 (Phase 1)

- L1 출력에 "nude" / L2 출력에 "caress" 가 섞일 수 있음
- 현재는 system clause + temperature 0.8 로 1차 방어만
- 위반 빈도 dogfooding ≥ 20% 면 Phase 2 진행

### 7.5 비-인물 차단 deterministic 불가 (Codex Finding 9)

- `VIDEO_VISION_SYSTEM` 출력이 자유 텍스트 — 코드 레벨 "ANCHOR person 판정" 불가
- 프롬프트 가이드 (`NON-HUMAN SUBJECT FALLBACK`) 로 best effort
- 풍경 이미지에서 자동 NSFW 발동하면 dogfooding §6.7 #7 로 발견 → 후속 plan 후보 (Vision 구조화 출력)

---

## 8. 확정 사항 (브레인스토밍 + Codex 리뷰 반영)

| # | 항목 | 확정 |
|---|------|------|
| 1 | 디폴트 강도 | **2 (옷벗음)** — 오빠 명시 |
| 2 | L1 라벨 한국어 | **"은근"** |
| 3 | L2 라벨 | **"옷벗음"** |
| 4 | L3 라벨 | **"옷벗음+애무"** |
| 5 | gemma4 응답 검증 Phase 2 | **별도 plan** (dogfooding 후 결정 · YAGNI) |
| 6 | 자동 시나리오 토글 라벨 | **"🤖 자동 NSFW 시나리오"** |
| 7 | 자동 모드 temperature | **0.8** (기존 0.6 보다 약간 상향) |
| 8 | 트리거 조건 | **별도 토글 (adult ON 위에)** |
| 9 | 제어 방식 | **강도 슬라이더 1~3** |
| 10 | grafting 정책 | **AI 자동 메인 + 사용자 지시 양념** |
| 11 | 비-인물 처리 | **프롬프트 가이드 best effort** (코드 게이트 X) |
| 12 | skipUpgrade 충돌 | **autoNsfw=true 면 강제 OFF (3-layer 방어)** |

---

## 9. Migration & Backward Compatibility

### 9.1 Schema 호환

- pre-spec 호출자 (`autoNsfw` 키 없이 meta JSON) → `autoNsfw=false` default → 기존 흐름 그대로
- backend default kwarg 패턴 — 모든 함수 시그니처
- 새 kwarg 는 **keyword-only** (spec 2026-05-11 v1.1 패턴) — silent 누락 차단

### 9.2 History v9 → v10 migration

- 위치: `backend/studio/history_db/schema.py`
- `SCHEMA_VERSION = 10`
- ALTER TABLE 두 줄 (auto_nsfw INTEGER DEFAULT 0, nsfw_intensity INTEGER nullable)
- `items.py` save/restore 동시 수정 (mode=video 일 때만 의미)
- 기존 row: `auto_nsfw=0` (DEFAULT) · `nsfw_intensity=NULL` — onReuse 시 false 자연 복원

### 9.3 Frontend persist 호환

- `useSettingsStore` zustand persist version bump 또는 default fallback
- 신규 필드 없는 기존 localStorage 데이터 → default 값 (false / 2) 자연 적용
- persist migrate 함수 또는 fallback 패턴 둘 다 검토 — plan 단계에서 결정

---

## 10. Out of Scope (재확인)

§2.2 와 동일. 명시 재기록:
- gemma4 응답 검증 Phase 2 (위반 키워드 재호출)
- Vision 시스템 구조화 출력 (자유 텍스트 → JSON)
- 시나리오 type chip 선택 UI
- Wan 2.2 i2v 용 NSFW LoRA
- t2v 모드 / vision 없는 케이스
- 5초 이상 영상 확장
- 자동 시나리오 강도별 history pill 표시

---

## 11. Acceptance Criteria

구현 완료 시 다음 조건 충족:

- [ ] Backend 6항목 (§2.1 #1~#6) 완료
- [ ] Frontend 6항목 (§2.1 #7~#13) 완료 (그중 #11~#13 은 #10 분해)
- [ ] pytest +10 신규 PASS · vitest +4 신규 PASS · 회귀 0 · tsc/lint clean
- [ ] §6.7 dogfooding 9 케이스 사용자 시각 검증 OK
- [ ] §5.1 validation 매트릭스 11 케이스 모두 정상 동작
- [ ] §5.7 skipUpgrade 3-layer 방어 동작 검증
- [ ] §5.4 비-인물 이미지에서 NSFW 자동 발동 안 되는지 검증
- [ ] history onReuse 시 강도 복원 동작

---

**다음 단계**: `writing-plans` 스킬로 구현 plan 작성 → subagent-driven-development 로 구현 → codex 활용 (10분 응답 없으면 미사용) → master merge.
