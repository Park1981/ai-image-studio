# Video CTA + 입력 활성화 매트릭스 정리 (Spec v1.2)

**작성일**: 2026-05-13
**상태**: 기획 v1.2 (사용자 review 2라운드 3 finding 반영)
**작성자**: Opus 4.7 (사용자 공동 기획 + review)
**관련 spec**: `docs/superpowers/specs/2026-05-12-video-auto-nsfw-scenario-design.md` (자동 NSFW 시나리오 v1.1)
**관련 fix**: `useVideoPipeline.generate()` 의 prompt 가드 단일 게이트 동기화 (2026-05-13 인라인 fix · spec 작성 시점 이미 적용)

---

## 0. v1.0 → v1.1 변경 자취

| # | 항목 | v1.0 (오답) | v1.1 (정정) |
|---|------|------------|------------|
| F1 | ComfyUI stopped → CTA 차단 | §2.5 에 차단 행 포함 | **제거** — `_dispatch.py:247` `_ensure_comfyui_ready` 가 진행 모달 stage emit 까지 하면서 자동 깨움. `useVideoPipeline.generate()` 는 ComfyUI stopped 토스트만 띄우고 통과. CTA 차단하면 Phase 5 자동 기동 UX 죽음. Ollama 만 외부 의존성으로 남김 (Ollama 는 backend 자동 기동 안 함 — CLAUDE.md "Ollama 상시" 가정) |
| F2a | skipUpgrade 위치 | `useSettingsStore.skipUpgrade` | **`useVideoStore.ts:107`** (`useSettingsStore` 에는 없음) |
| F2b | C2 시각 처리 방향 | `checked={false}` 강제 (AI 보강 OFF 시각) | **반대로 강제 ON 시각이 정답** — `VideoLeftPanel.tsx:340` `data-active={!skipUpgrade \|\| autoNsfwEnabled}` 이미 자동 NSFW 시 active 강제. effectiveSkipUpgrade=false 의 의미 = AI 보강 적용 = 시각 ON. 진짜 fix 는 표현식의 `autoNsfwEnabled` 단독 → `effectiveAutoNsfw` 동기화 (adult OFF + 유령 ON 차단) |
| F3 | textarea 만 disable 하면 입력 잠금 미완 | textarea `disabled` 한 줄만 | **PromptHistoryPeek, 클리어 버튼, PromptToolsButtons, PromptToolsResults 4 경로 모두 차단** — `VideoLeftPanel.tsx:279, 289, 293, 303` |
| F4 | AI 보강 토글 disable 방식 | `disabled={running \|\| effectiveAutoNsfw}` prop 추가 | **V5MotionCard `onClick` 가드 + Toggle flat 패턴** — `:341-344` 이미 `onClick={autoNsfwEnabled ? undefined : ...}` 패턴. flat Toggle 은 실제 checkbox 안 렌더. line 326 (`disabled={running}`) 은 AI 보강 토글이 아닌 **VideoModelSegment** 의 disable (오인) |
| F5 | USE_MOCK 비교 | `=== "true"` (env 미설정 시 false 가정) | **`client.ts:8-11` 의 `!== "false"`** (env 미설정도 Mock). `USE_MOCK` export 그대로 import 해서 사용 |
| F6 | 테스트 표현 | `aria-disabled="true"` / 312 PASS 예상 / 명령 경로 모호 | **native `disabled` attribute** (`:196`) / "회귀 0 + 신규 PASS" 통일 / `cd frontend/` 경로 명시 |

> v1.0 → v1.1: 사용자 review 6 finding 모두 정당 수용. F2b 와 F4 는 spec 작성자의 코드 오독 (Toggle flat 패턴 + data-active 표현식 의미) 이 근본 원인.

### v1.1 → v1.2 (사용자 review 2라운드)

| # | 항목 | v1.1 (구멍) | v1.2 (정정) |
|---|------|------------|------------|
| G1 | ollamaStatus 출처 명시 누락 | §2 코드에서 `ollamaStatus` 사용했는데 §3.1 에 import 안 박제 | **§3.1 에 `import { useProcessStore }` + `const ollamaStatus = useProcessStore((s) => s.ollama);` 라인 명시** — VideoLeftPanel.tsx 는 현재 useProcessStore 미사용 (확인됨) |
| G2 | hook 의 generate() Ollama defense-in-depth | CTA 만 차단 — `useVideoPipeline.generate()` 는 comfyuiStatus 만 검사 | **§3.7 신규 — `useVideoPipeline.generate()` 안에 `if (effectiveAutoNsfw && !USE_MOCK && ollamaStatus === "stopped")` 가드 추가**. CTA 외 다른 트리거 (단축키 등) 가능성 + defense-in-depth |
| G3 | T12 검증 DOM 모호 | "Toggle checked=true" — flat 모드는 `<input type="checkbox">` 미렌더 (`primitives.tsx:232`) | **`data-active="true"` (V5MotionCard) + PromptModeRadio 노출 (`role="radiogroup"` 등) + 카드 클릭 시 setSkipUpgrade mock 미호출** 3-앵글 검증으로 정정 |

> v1.1 → v1.2: 3 finding 정당 수용. G3 는 Toggle 컴포넌트의 flat prop 동작 (`primitives.tsx:232`) 을 spec 작성자가 충분히 박제 안 한 결과.

---

## 1. Context — 왜 이 변경이 필요한가

2026-05-12 자동 NSFW 시나리오 (v1.1) 도입 후, 사용자가 다음 시나리오에서 백엔드 400 ("prompt required") 을 경험:

> 이미지 로드 + 성인모드 OFF + 영상 지시 빈칸 + (어제 자동 NSFW 켜둔 게 settings store v7 persist 로 살아있음) → CTA 클릭 가능 → 400.

근본 원인은 **frontend 가드 단일 게이트 위반**:

- 자동 NSFW 발동 진짜 게이트: `effectiveAutoNsfw = adult && autoNsfwEnabled` (백엔드 `streams.py:325` 강제 일치)
- 그런데 기존 `useVideoPipeline.generate()` 의 prompt 가드는 `autoNsfwEnabled` 단독 검사 → adult OFF + 유령 ON 상태에서 false negative
- `VideoLeftPanel.tsx:140-142` 의 `ctaDisabled` 도 동일 패턴 (`promptRequired = !autoNsfwEnabled`)

`useVideoPipeline.ts` 는 1줄 fix 로 `effectiveAutoNsfw` 단일 진실원으로 추출되어 인라인 적용됨. 본 spec 은 **VideoLeftPanel 의 CTA + 입력 disable 매트릭스를 사용자 멘탈 모델에 맞춰 일관화**.

### 사용자 멘탈 모델 (brainstorming 확정)

> "성인모드가 1차 ON/OFF 이고, 성인모드 ON 이면 0~3단계 segmented 가 생긴다. 0단계면 영상 지시가 있어야 하고, 1단계 이상에서는 영상 지시 박스가 비활성화된다."

내부 state 는 기존 (`autoNsfwEnabled: boolean` + `nsfwIntensity: 1|2|3`) 그대로 유지. UI 라벨도 현재 "OFF / 1단계 / 2단계 / 3단계" 유지 (사용자 결정). 멘탈 모델 "0단계" = UI "OFF" 와 1:1 매핑.

---

## 2. 매트릭스 (단일 진실원)

`effectiveAutoNsfw = adult && autoNsfwEnabled` 단일 게이트 기준:

| # | 이미지 | 지시 trim | adult | nsfw | effectiveAutoNsfw | CTA | 지시 textarea | AI 보강 토글 | promptMode |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ❌ | — | — | — | — | 🔴 disabled | — | — | — |
| 2 | ✅ | ❌ | OFF | — | false | 🔴 disabled | 🟢 enabled | 🟢 enabled | 🟢 enabled |
| 3 | ✅ | ✅ | OFF | — | false | 🟢 enabled | 🟢 enabled | 🟢 enabled | 🟢 enabled |
| 4 | ✅ | ❌ | ON | OFF (0단) | false | 🔴 disabled | 🟢 enabled | 🟢 enabled | 🟢 enabled |
| 5 | ✅ | ✅ | ON | OFF (0단) | false | 🟢 enabled | 🟢 enabled | 🟢 enabled | 🟢 enabled |
| 6 | ✅ | * | ON | 1~3단 | true | 🟢 enabled | 🔴 disabled (자동 작성) | 🔴 disabled | 🔴 disabled |

`*` 6번에서 지시 textarea 는 사용자가 미리 입력했어도 자동이 덮어쓰므로 disable 상태로 강제 (시각 신호). **textarea value 는 그대로 보존** — 사용자가 0단 복귀 시 입력값 살아있어 자연스러운 회복 (C4 결정 = A 보존).

### 파생 규칙 (구현 시 단일 진실원)

```typescript
import { USE_MOCK } from "@/lib/api/client";        // F5: !== "false" 판정 (env 미설정도 Mock)

const effectiveAutoNsfw = adult && autoNsfwEnabled;  // 게이트
const promptRequired = !effectiveAutoNsfw;
// F1: ComfyUI 는 backend `_dispatch.py:247` 가 자동 깨움 → CTA 차단 X.
// Ollama 만 검사 (자동 NSFW 시) — Ollama 는 backend 자동 기동 안 함 (상시 가정).
const externalDepsReady =
  USE_MOCK || !effectiveAutoNsfw || ollamaStatus === "running";
// C5: mock-seed:// 결과 이미지는 영상 소스로 못 쓰므로 사전 차단.
const isInvalidSource =
  typeof sourceImage === "string" && sourceImage.startsWith("mock-seed://");
const ctaDisabled =
  running ||
  !sourceImage ||
  isInvalidSource ||
  (promptRequired && !prompt.trim()) ||
  !externalDepsReady;
```

`effectiveAutoNsfw` 가 영향을 주는 시각/입력 차단은 §3 의 5 컴포넌트 분기 참조 (단순 prop 한 줄이 아니라 각 컴포넌트 패턴마다 다름).

## 2.5 외부 의존성 게이트 (C1 · 직교 분기 · F1 정정)

§2 매트릭스 모든 케이스에 다음 조건 직교 적용 — `useProcessStore.ollama` 만 검사:

| ollama | effectiveAutoNsfw | USE_MOCK | CTA | 비고 |
|--------|---|---|-----|------|
| `running` | * | * | §2 매트릭스대로 | 정상 |
| `stopped` | false | * | §2 매트릭스대로 | 일반 영상은 skipUpgrade 로 사용자 우회 가능 (Ollama 호출 안 함) |
| `stopped` | **true** | false | 🔴 disabled | 자동 NSFW 는 vision+gemma4 둘 다 Ollama 필수 (spec 2026-05-12 §5.7) |
| `stopped` | true | **true** | §2 매트릭스대로 | Mock 모드는 실제 호출 안 하므로 통과 |

**ComfyUI 는 본 spec 범위 외**:
- backend `_dispatch.py:247` `_ensure_comfyui_ready` 가 stopped 시 진행 모달 stage emit (`"comfyui-warmup"`) 까지 하면서 자동 깨움 (Phase 5 자동 기동).
- frontend `useVideoPipeline.generate()` 의 ComfyUI stopped 토스트 ("ComfyUI가 정지 상태입니다 ...") 는 *안내 차원* — 통과 후 backend 가 깨움.
- CTA 사전 차단하면 자동 기동 UX 죽음. 현재 동작 보존.

근거:
- `ProcStatus = "running" \| "stopped"` 만 존재 (`useProcessStore.ts:17`). `starting` 상태 없음 (C6 dead).
- Ollama 는 backend 자동 기동 안 함 — 사용자가 직접 시작 또는 시스템 상시 (CLAUDE.md "Ollama 상시 / ComfyUI 자동" 박제).
- Mock 모드 (`USE_MOCK` true · env 미설정 또는 `NEXT_PUBLIC_USE_MOCK !== "false"`) 는 실제 호출 안 함 → CTA 통과.

---

## 3. 적용 위치 (VideoLeftPanel.tsx + 보조 컴포넌트들)

### 3.1 effectiveAutoNsfw 단일 진실원 추출 + 외부 의존성 import (G1)

`VideoLeftPanel.tsx` 는 현재 `useProcessStore` 를 import 하지 않음 (확인됨 — `comfyuiStatus` 는 `useVideoPipeline` 내부에서만 사용). ollamaStatus 사용 위해 신규 import + 라인 추가:

```typescript
// 기존 import 블록에 추가
import { useProcessStore } from "@/stores/useProcessStore";
import { USE_MOCK } from "@/lib/api/client";

// VideoLeftPanel 컴포넌트 본문 상단 (다른 useStore 후크 옆)
const ollamaStatus = useProcessStore((s) => s.ollama);
```

그 다음 line 140 부근에 §2 의 파생 규칙 블록 (effectiveAutoNsfw + externalDepsReady + isInvalidSource + ctaDisabled) 을 추가. 기존 `promptRequired = !autoNsfwEnabled` 1줄 정의는 § 2 의 단일 진실원 블록으로 교체.

### 3.2 영상 지시 입력 — 4 경로 모두 잠금 (F3)

`textarea.disabled` 한 줄로 끝나지 않음. `VideoLeftPanel.tsx:268-303` 의 prompt 변경 진입점 모두 차단:

| 라인 (현재) | 컴포넌트 / 동작 | v1.2 변경 |
|---|---|---|
| 279 | `<PromptHistoryPeek mode="video" onSelect={(p) => setPrompt(p)} />` | `effectiveAutoNsfw` 시 **렌더 안 함** (또는 `disabled` prop 추가 — plan 단계에서 컴포넌트 사양 확인) |
| 280-287 | `<textarea value={prompt} onChange={setPrompt(...)}>` | `disabled={effectiveAutoNsfw}` + CSS `[disabled]` 회색 |
| 289 | `<PromptToolsButtons tools={promptTools} />` | `effectiveAutoNsfw` 시 **렌더 안 함** (번역/분리 도구가 prompt 변경하므로) |
| 290-300 | 클리어 버튼 `onClick={setPrompt("")}` | `effectiveAutoNsfw` 시 **렌더 안 함** (조건 `prompt.length > 0 && !effectiveAutoNsfw`) |
| 303 | `<PromptToolsResults tools={promptTools} />` | `effectiveAutoNsfw` 시 **렌더 안 함** (적용 시 prompt 변경) |

**입력값 보존 (C4 옵션 A)**: textarea `value={prompt}` 는 그대로. disable 만 → 사용자가 1단 토글하면 textarea 회색 (입력값 살아있음) → 0단 복귀 시 textarea 재활성화 + 값 복원.

### 3.3 AI 보강 카드 — V5MotionCard onClick 가드 + Toggle flat 패턴 (F2b · F4)

`VideoLeftPanel.tsx:338-365` 의 카드는 `disabled` prop 컴포넌트가 아니라 **V5MotionCard `onClick` 가드 + 자식 Toggle flat 패턴**. 현재 코드는 이미 `autoNsfwEnabled` 검사로 작동 — `effectiveAutoNsfw` 로 동기화만:

| 라인 (현재) | 표현식 / prop | v1.2 변경 |
|---|---|---|
| 340 | `data-active={!skipUpgrade \|\| autoNsfwEnabled}` | `... \|\| effectiveAutoNsfw` |
| 341-344 | `onClick={autoNsfwEnabled ? undefined : () => setSkipUpgrade(!skipUpgrade)}` | `onClick={effectiveAutoNsfw ? undefined : ...}` |
| 345-351 | `tooltip` 분기 (`autoNsfwEnabled` 단독) | `tooltip` 분기 `effectiveAutoNsfw` 로 동기화 |
| 356 | `<Toggle checked={!skipUpgrade \|\| autoNsfwEnabled}>` | `<Toggle checked={!skipUpgrade \|\| effectiveAutoNsfw}>` |
| 360 | `<Toggle disabled={autoNsfwEnabled}>` | `<Toggle disabled={effectiveAutoNsfw}>` |
| 362 | `{(!skipUpgrade \|\| autoNsfwEnabled) && <PromptModeRadio ... />}` | `{(!skipUpgrade \|\| effectiveAutoNsfw) && <PromptModeRadio ... disabled={effectiveAutoNsfw} />}` |

**시각 의미 박제 (F2b 정정)**:
- `effectiveSkipUpgrade = false` 시 = AI 보강 적용 (vision + gemma4 실행).
- 자동 NSFW ON 시 `effectiveSkipUpgrade = false` 강제 → AI 보강 시각도 **ON 강제** (`data-active=true` + `Toggle` 의 `checked` prop true) 가 사용자 의도와 일치. 단, `<Toggle flat>` 은 checkbox DOM 을 렌더하지 않으므로 테스트는 `checked` DOM 속성이 아니라 T12 의 3-앵글 방식으로 검증.
- v1.0 의 "checked=false 강제" 는 의미 반대 → 폐기.

**Toggle flat 패턴 박제 (F4)**:
- `<Toggle flat>` 은 실제 checkbox 안 렌더 — V5MotionCard `onClick` 이 토글 동작 담당.
- 따라서 차단의 진짜 진입점은 카드의 `onClick` 가드 (`effectiveAutoNsfw ? undefined : ...`). Toggle `disabled` prop 은 시각 보조.

### 3.4 PromptModeRadio CSS disable (C3 · 유지)

`frontend/components/studio/PromptModeRadio.tsx` 는 **현재 `disabled` prop + CSS 모두 미지원**. 신규 prop 추가:

```typescript
interface Props {
  value: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;        // 신규 optional
}
```

- 컨테이너 `<div>` 에 `data-disabled={disabled ? "true" : undefined}`
- 각 `<button>` 에 `disabled={disabled}` (native disabled — `pointer-events` 자동 차단)
- 클릭 핸들러 가드 `if (disabled) return;`
- `globals.css` 에 CSS 추가:
  ```css
  .ais-prompt-mode-segmented[data-disabled="true"] {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;  /* thumb hover 등 잔여 인터랙션 차단 */
  }
  ```

Generate / Edit Panel 사용처는 prop 미전달 → 회귀 0.

### 3.5 C5 — mock-seed:// 사전 차단

`sourceImage` 가 string 이고 `mock-seed://` prefix 면 §2 의 `isInvalidSource = true` → `ctaDisabled` 분기. 시각 신호 안내는 본 spec 범위 외 (사용자 사용 빈도 낮음).

### 3.6 C6 — 폐기

`ProcStatus = "running" | "stopped"` 만 존재 (`useProcessStore.ts:17`). `starting` 상태 없음 — C6 항목 제거.

### 3.7 useVideoPipeline.generate() defense-in-depth (G2 신규)

CTA 차단은 panel 진입점만 막음. CTA 외 (단축키, 다른 트리거 등) 또는 race 시점에 `generate()` 직접 호출 가능. `useVideoPipeline.generate()` 에 **Ollama 가드 추가**:

```typescript
// 기존 import 보강 (useProcessStore 는 이미 import 되어 있으면 재추가 X)
import { USE_MOCK } from "@/lib/api/client";

// 기존 comfyuiStatus 옆에 ollamaStatus 추가
const ollamaStatus = useProcessStore((s) => s.ollama);

// generate() 안 — prompt 필수 가드 직후, ComfyUI 안내 토스트보다 먼저
if (effectiveAutoNsfw && !USE_MOCK && ollamaStatus === "stopped") {
  toast.warn(
    "Ollama가 정지 상태입니다.",
    "자동 NSFW 는 vision + gemma4 (Ollama) 가 필요합니다. 설정에서 시작해 주세요.",
  );
  return;
}
```

근거:
- CTA `disabled` 는 UI 진입점만 차단. 단축키 / 외부 트리거 / 미래 진입점 등은 안 막힘.
- Ollama 정지 시 자동 NSFW pipeline 의 vision 모델 첫 호출에서 실패 → 모호한 에러. 사전 toast 가 친절.
- ComfyUI 는 backend 자동 기동이라 가드 X — 기존 ComfyUI stopped 토스트만 유지 (안내 차원).
- USE_MOCK 분기로 Mock 모드 통과 보장.

이 가드는 panel CTA disable 과 동일한 조건 (§2.5 외부 의존성 게이트) 의 2차 방어. 둘 다 fail-soft (panel 미사용 / hook 직접 호출 / settings store race) 케이스에서 명확한 안내.

---

## 4. 비목표 (YAGNI)

- ❌ 영상 지시 textarea 의 placeholder / 라벨 안내문구 변경 — L1 사용자 결정 (불필요)
- ❌ ProgressModal 띄워진 상태에서 좌측 패널 input 별도 disable — 모달 backdrop (`position:fixed inset:0 zIndex:60`) 이 클릭 차단으로 충분 (L5)
- ❌ "0단계" 라벨로 변경 — UI 는 "OFF / 1단계 / 2단계 / 3단계" 유지 (사용자 결정)
- ❌ `useSettingsStore.autoNsfwEnabled` 를 adult OFF 시 자동 reset — 어제 brainstorming 옵션 A 선택 (마지막 상태 보존)
- ❌ 백엔드 검증 변경 — `streams.py:325-332` 의 검증은 이미 effectiveAutoNsfw 와 일치 (race 차단 정상 동작)
- ❌ ProcStatus `starting` 상태 추가 — store 자체 미존재 (C6 dead · `useProcessStore.ts:17`)
- ❌ mock-seed:// 사용 시 명시적 UI 안내 토스트 — CTA 사전 차단으로 충분 (C5 minimal · 발생 빈도 낮음)
- ❌ textarea 입력값 자동 clear — C4 옵션 A (보존 + 회색) 선택. 데이터 손실 X / 0단 복귀 시 자연스러운 복원
- ❌ Generate / Edit 페이지에 같은 매트릭스 일반화 — 두 페이지는 자동 NSFW / Ollama 의존성 분기가 다름. 별도 spec 명목 (필요 시)
- ❌ "성인모드 OFF → autoNsfwEnabled persist=true" 의 시각 안내 — 본 spec 의 CTA disable 로 결과적 차단 충분
- ❌ ComfyUI stopped 시 CTA 사전 차단 — F1 박제. backend `_dispatch.py:247` 의 Phase 5 자동 기동이 진행 모달 stage emit (`"comfyui-warmup"`) 까지 하면서 사용자에게 알림. CTA 차단하면 그 UX 죽음
- ❌ AI 보강 토글의 `<Toggle disabled={...}>` 만으로 차단 완료 가정 — F4 박제. flat 토글은 실제 checkbox 안 렌더 + 클릭은 V5MotionCard onClick 담당이라 카드 onClick 가드가 진짜 진입점

---

## 5. 테스트 시나리오

### 5.1 신규 vitest

`__tests__/video-cta-gating.test.tsx` (또는 기존 `video-auto-nsfw-integration.test.tsx` 확장):

| # | 시나리오 | 검증 |
|---|---------|------|
| T1 | sourceImage=null | CTA `button.disabled === true` (native attribute · F6) |
| T2 | adult OFF + 빈 지시 | CTA disabled |
| T3 | adult OFF + 지시 있음 | CTA enabled |
| T4 | adult ON + 0단 + 빈 지시 | CTA disabled |
| T5 | adult ON + 0단 + 지시 있음 | CTA enabled |
| T6 | adult ON + 1단 | CTA enabled, 영상 지시 textarea `disabled`, V5MotionCard onClick 가드 (클릭해도 setSkipUpgrade 안 불림), PromptModeRadio `data-disabled="true"` |
| T7 | 유령 NSFW (adult OFF + autoNsfwEnabled persist true) + 빈 지시 | CTA disabled (400 사전 차단) |
| T8 | ollama="stopped" + adult OFF | CTA enabled (일반 영상은 Ollama 의존성 X — skipUpgrade 사용자 우회 가능) |
| T9 | ollama="stopped" + adult ON + 1단 | CTA disabled (자동 NSFW Ollama 필수) |
| T10 | ollama="stopped" + USE_MOCK=true | CTA enabled (Mock 통과) |
| T11 | mock-seed:// 소스 | CTA disabled (C5) |
| T12 | adult ON + 1단 + skipUpgrade persist true | **3-앵글 검증** (G3 · Toggle flat checkbox 미렌더): (a) V5MotionCard `data-active="true"`, (b) `PromptModeRadio` 가 DOM 에 렌더됨 (`role="radiogroup"` 발견), (c) 카드 클릭 시 `setSkipUpgrade` mock 미호출 |
| T13 | adult ON + 1단 + PromptModeRadio | 컨테이너 `data-disabled="true"` + 모든 button `disabled` (C3) |
| T14 | textarea value 보존 | "내가 입력함" → adult ON + 1단 → textarea disabled value 그대로 → 0단 복귀 → enabled + value 그대로 (C4 A) |
| T15 | adult ON + 1단 → PromptHistoryPeek 렌더 X (F3) | `screen.queryByText("프롬프트 히스토리")` 또는 동등 셀렉터 not found |
| T16 | adult ON + 1단 → PromptToolsButtons / Results 렌더 X (F3) | 동등 셀렉터 not found |
| T17 | adult ON + 1단 → 클리어 버튼 렌더 X (F3) | `aria-label="프롬프트 비우기"` not found |

> USE_MOCK 분기 테스트 주의: `USE_MOCK` 은 `client.ts` import 시점 상수라 T9(false) / T10(true) 은 같은 정적 import 파일 안에서 env 만 바꿔 검증하면 캐시 때문에 흔들릴 수 있음. `vi.mock("@/lib/api/client", ...)` 또는 `vi.resetModules()` + 동적 import 로 케이스를 분리.

> ComfyUI stopped 케이스는 본 spec 범위 외 (F1 — backend 자동 기동) — 별도 검증 없음.

### 5.2 수동 dogfood

오빠 케이스 + 추가 발굴:
1. 이미지 로드 + 성인모드 OFF + 영상 지시 빈칸 → CTA 회색
2. 영상 지시 입력 → CTA 활성화
3. 성인모드 ON + 자동 NSFW 1단계 → 영상 지시 textarea 회색 (값 보존) + PromptHistoryPeek/Tools/클리어 모두 사라짐 + AI 보강 카드 강제 ON 시각 (활성 표시) + 카드 클릭해도 토글 안 됨 + PromptModeRadio 회색
4. 자동 NSFW 0단 복귀 → 위 셋 복귀 + textarea 입력값 살아있음
5. ComfyUI 설정에서 정지 → CTA **여전히 활성** (backend 가 자동 깨움) — 토스트 확인
6. Ollama 정지 + 성인 ON + 1단 → CTA 회색
7. Mock 결과 이미지 → CTA 회색

---

## 6. 영향 받는 파일

| 파일 | 변경 종류 | 비고 |
|---|---|---|
| `frontend/components/studio/video/VideoLeftPanel.tsx` | edit | §3.1 단일 진실원 + useProcessStore/USE_MOCK import + §3.2 입력 4 경로 렌더/disable 가드 + §3.3 AI 보강 카드 6 위치 (effectiveAutoNsfw 동기화) |
| `frontend/hooks/useVideoPipeline.ts` | edit | §3.7 신규 — USE_MOCK import + ollamaStatus + generate() 의 Ollama defense-in-depth 가드. 2026-05-13 인라인 1줄 fix (effectiveAutoNsfw) 도 같이 commit |
| `frontend/components/studio/PromptModeRadio.tsx` | edit | §3.4 `disabled` optional prop + `data-disabled` |
| `frontend/app/globals.css` | edit | §3.4 `.ais-prompt-mode-segmented[data-disabled="true"]` CSS |
| `frontend/__tests__/video-auto-nsfw-integration.test.tsx` | extend | T1~T17 (17 케이스) |
| `docs/changelog.md` | append | 변경 로그 한 줄 |

**Note** (plan 단계 확인 명목):
- `PromptHistoryPeek` (어떤 파일에 있는지 + `disabled` prop 지원 여부 — 미지원이면 조건부 렌더로 처리)
- `PromptToolsButtons` / `PromptToolsResults` (`@/components/studio/prompt-tools/` · `tools` prop 외 `disabled` 지원 여부)
- 셋 다 미지원이면 조건부 렌더 (`{!effectiveAutoNsfw && <X />}`) 가 minimal change.

테스트 회귀 0 + 신규 T1~T17 PASS. (현재 vitest 298 — 신규 +n PASS 목표, 정확한 추가 수는 구현 시 확정.)

---

## 7. 구현 후 검증 체크리스트

PowerShell 기준 (`cd D:\AI-Image-Studio\frontend` 후):

- [ ] `npx tsc --noEmit` clean
- [ ] `npx eslint components/studio/video/VideoLeftPanel.tsx components/studio/PromptModeRadio.tsx` clean
- [ ] `npx vitest run __tests__/video-auto-nsfw` 신규 T1~T17 PASS
- [ ] `npx vitest run` 전체 회귀 0 (기존 298 PASS 유지 + 신규 PASS)
- [ ] 수동 dogfood §5.2 의 7 시나리오
