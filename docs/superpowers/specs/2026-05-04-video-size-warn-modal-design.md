# Video 큰 사이즈 경고 모달 (Spec v1.4)

**작성일**: 2026-05-04
**상태**: 기획 v1.4 (사용자 + Codex review 4라운드 반영)
**작성자**: Opus 4.7 (사용자 공동 기획 · Codex iterative review)
**대상 파일**: `docs/superpowers/specs/2026-05-04-video-size-warn-modal-design.md`
**관련 spec**: `docs/superpowers/specs/2026-05-03-video-model-selection-wan22.md` (Wan 2.2 / LTX 2.3 듀얼 구조)

---

## 0. v1 → v1.4 변경 요약

| # | 항목 | v1 (초안) | v1.4 (현재) |
|---|------|----------|------------|
| 1 | `shouldWarnVideoSize` 가드 | 임계 비교만 | **NaN/Infinity/≤0 방어 가드** 추가 (소스 미선택 + 계산 꼬임 안전망) |
| 2 | `handleCtaClick` 방어 | 임계 분기만 | **`running \|\| warnOpen \|\| ctaDisabled` early return** 추가 |
| 3 | `handleConfirmWarn` 순서 | 명시 X | **`setWarnOpen(false)` → `onGenerate()` 순서** 명시 (모달 잔류 프레임 ↓) |
| 4 | 헬퍼 위치 | `useVideoStore.ts` 안 export | **`frontend/lib/video-size.ts` 신규 분리** (store 결합 제거 · 순수 util) |
| 5 | 테스트 수 표현 | "178 → 191 PASS" / "178 → 196 추정" 이중 | "**신규 PASS + 기존 regression 0**" 기준으로 통일 |
| 6 | UX 문구 | "큰 사이즈로 진행하시겠어요?" / "컴퓨터 제원 제약으로 영상 생성이 오래…" | "**큰 사이즈로 생성할까요?**" / "**현재 컴퓨터 제원에서는 생성 시간이 오래 걸리거나 중간에 중단될 수 있어요.**" |
| 7 | `simplifyRatio` 1차 가드 | 임계 입력만 가정 (가드 없음) | **NaN/Infinity/≤0 → `"-"` 반환** + `Math.round` 적용 (util 분리 후 호출자 확장 안전망 · `shouldWarnVideoSize` 와 가드 일관성) |
| 8 | `simplifyRatio` 2차 가드 | 1차 가드만 (round 전 체크) | **round 후에도 `wi <= 0 \|\| hi <= 0` 재검증** (예: `0.4×0.4` → round → `0×0` race 방지) |
| 9 | `VideoSizeWarnModal` ESC cleanup | "ESC + overlay 클릭 핸들러 내장" 한 줄 | **`useEffect` cleanup (`removeEventListener`) 명시 코드 블록** — 모달 unmount 시 글로벌 keydown 누수 방지 |
| 10 | `expected` 단일 진실원 | panel 끌어올림 + slider 시그니처 변경 (한 줄) | **`VideoLeftPanel` 단일 계산 → `VideoResolutionSlider` + `VideoSizeWarnModal` 둘 다 같은 값을 prop 으로 받음** 명시. slider 표시값 ↔ 모달 표시값 불일치 race 차단 |

> v1.0 (초안) → v1.1 (사용자 review 1라운드, 항목 1~6) → v1.2 (사용자 + Codex review 2라운드, 항목 7) → v1.3 (사용자 + Codex review 3라운드, 항목 8~9) → v1.4 (사용자 + Codex review 4라운드, 항목 10).
>
> Codex iterative review 패턴 적용 (memory `feedback_codex_iterative_review.md`) — 각 라운드 fix 인라인 통합 + 변경 자취 §0 박제.

---

## 1. Context — 왜 이 변경이 필요한가

영상 생성 모드 (`/video`) 는 16GB VRAM 환경에서 모델별 처리 시간이 출력 픽셀수에 강하게 비례합니다.

| 출력 | Wan 2.2 Q6_K · Lightning ON | 비고 |
|------|----------------------------|------|
| 832×480 (5초) | **약 320초** (사용자 실측 2026-05-03) | base 케이스 |
| 1280×720 추정 | ~10분 | 픽셀수 ~2.4배 |
| 1536×864 추정 | ~15분+ | 픽셀수 ~3.4배 + sysmem swap 임박 |
| 1536×1024+ | 20분+ 또는 ComfyUI idle timeout | 16GB VRAM 한계 ↑ |

현재 인지 수단은 좌측 슬라이더 옆 **속도 chip** (`pickSpeedTone` · emerald/cyan/amber/rose) 이 유일하지만:

- 시각 hint 일 뿐 진행을 **차단하지 않음**
- 사용자가 "📐 원본" 버튼으로 즉시 1536 으로 점프 가능 (clamp + step snap)
- 큰 사이즈로 Render 누른 뒤 "왜 이렇게 오래…?" 인지 시점이 늦음

**결론**: Render 클릭 시점에 **출력 예상 W×H 임계 체크 + 한 박자 확인 모달** 로 사용자가 사이즈를 다시 한 번 인지하고 결정하게 합니다.

### 비목표 (YAGNI)

- 모델별 (Wan 2.2 / LTX 2.3) 차등 임계 — 사용자 결정 "모델 상관없이"
- 추정 시간 표시 — 정확도 보장 어려움 (Wan/LTX/Lightning ON/OFF 4 조합 + sysmem swap 변동성)
- "다시 묻지 않기" dismiss 옵션 — 사용자 결정 "무조건"
- 모달 안에서 직접 사이즈 변경 — 사용자 결정 "단순하게" (좌측 슬라이더로 위임)
- "📐 원본" 버튼 클릭 시점 사전 경고 — Render 시점에서만 (단일 진입점)

---

## 2. 사용자 확정 결정 사항 (2026-05-04)

| # | 항목 | 결정 |
|---|------|------|
| 1 | 트리거 임계 | **출력 예상 W×H 기준** · `(W ≥ 1280 ∨ H ≥ 1280) ∨ (W ≥ 1000 ∧ H ≥ 1000)` |
| 2 | 모델 차등 | 없음 (Wan 2.2 / LTX 2.3 동일 임계) |
| 3 | 사이즈 변경 UX | 모달 안에서 변경 X · `[취소]` 누르면 좌측 슬라이더로 위임 |
| 4 | dismiss 옵션 | 없음 (매번 띄움) |
| 5 | 트리거 시점 | "Render" CTA 클릭 시 1회 (다른 진입점 없음) |
| 6 | 버튼 | `[취소]` / `[그대로 진행]` |
| 7 | 모달 핵심 문구 | "컴퓨터 제원 제약으로 영상 생성이 오래 걸리거나 중간에 중단될 수 있어요" 정리 톤 |

---

## 3. UX 흐름

```
사용자: 좌측 슬라이더로 사이즈 조정 → "Render" 클릭
           │
           ▼
  ┌──────────────────────────────┐
  │ 출력 예상 W×H 임계 체크       │
  │ (computeVideoResize 결과)     │
  └──────────────┬───────────────┘
                 │
        ┌────────┴────────┐
        │                 │
   임계 미만           임계 충족
        │                 │
        ▼                 ▼
  generate() 호출    경고 모달 표시
                          │
                  ┌───────┴───────┐
                  │               │
            [그대로 진행]      [취소]
                  │               │
                  ▼               ▼
            generate() 호출   모달 닫기 + 종료
                              (사용자가 좌측 슬라이더로
                               사이즈 조정 → 다시 Render)
```

---

## 4. 모달 디자인

### 4.1 타이틀 + 본문

| 요소 | 내용 |
|------|------|
| **타이틀** | "큰 사이즈로 생성할까요?" |
| **본문 1줄** | "현재 컴퓨터 제원에서는 생성 시간이 오래 걸리거나 중간에 중단될 수 있어요." |
| **현재 사이즈 표기** | `출력 1536×864 · 16:9` (mono · accent 색상 강조) |
| **버튼** | `[취소]` (secondary · 좌) / `[그대로 진행]` (primary · 우) |

### 4.2 인터랙션

| 동작 | 결과 |
|------|------|
| `[취소]` 클릭 | 모달 닫기 · `running` 변동 없음 · `onGenerate` 미호출 |
| `[그대로 진행]` 클릭 | 모달 닫기 · 즉시 `onGenerate()` 호출 |
| `ESC` 키 | `[취소]` 와 동일 |
| Overlay 클릭 (모달 외부) | `[취소]` 와 동일 |

### 4.3 스타일 참조

`UpgradeConfirmModal.tsx` 의 dialog shell 패턴 그대로 차용:
- `role="dialog"` + `aria-modal="true"` + `aria-label="영상 사이즈 확인"`
- `position: fixed; inset: 0; zIndex: 65; background: rgba(23,20,14,.42)`
- `min(680px, 100%)` width · 둥근 모서리 + shadow-lg
- `var(--bg)` / `var(--line)` / `var(--ink)` 디자인 토큰 사용
- 버튼 스타일: `primaryBtnStyle` / `secondaryBtnStyle` 그대로

크기는 텍스트 양이 적어 더 작게 (`min(440px, 100%)`).

---

## 5. 구현 위치

### 5.1 신규 파일

#### 5.1.1 `frontend/lib/video-size.ts` (순수 util · 신규)

```ts
// 영상 출력 사이즈 경고 임계 + 공용 비율 유틸.
// store/component 어느 쪽에도 결합되지 않은 순수 함수로 유지 — 테스트 시 mock 불필요.

export const VIDEO_WARN_LONGER_EDGE = 1280;
export const VIDEO_WARN_BOTH_EDGE = 1000;

/**
 * 출력 W×H 가 경고 임계를 충족하는지.
 *
 * 가드:
 *  - NaN / Infinity → false (계산 꼬임 안전망)
 *  - ≤ 0 → false (소스 미선택 시 expected = {0, 0} 차단)
 */
export function shouldWarnVideoSize(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;

  return (
    width >= VIDEO_WARN_LONGER_EDGE ||
    height >= VIDEO_WARN_LONGER_EDGE ||
    (width >= VIDEO_WARN_BOTH_EDGE && height >= VIDEO_WARN_BOTH_EDGE)
  );
}

/**
 * 정수 비율 근사 — "16:9" / "3:4" 등 (VideoLeftPanel.tsx:577 에서 이동).
 *
 * 가드 (v1.3 · 2-layer):
 *  - 1차: NaN / Infinity / ≤ 0 → "-" 반환
 *  - 소수 입력 정수 스냅: `Math.round` 적용 후 GCD
 *  - 2차: round 결과 ≤ 0 → "-" 반환 (예: 0.4×0.4 → 0×0 race 방지)
 */
export function simplifyRatio(w: number, h: number): string {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return "-";
  }

  const wi = Math.round(w);
  const hi = Math.round(h);
  if (wi <= 0 || hi <= 0) return "-";

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(wi, hi);
  return `${wi / g}:${hi / g}`;
}
```

> **결정 근거** (v1.1): v1 은 `useVideoStore.ts` 에 두려 했지만, `shouldWarnVideoSize` / `simplifyRatio` 는 zustand state 와 무관한 순수 계산 함수. 분리하면 (1) 테스트가 store mock 없이 import 만으로 되고 (2) 모달이 store 결합 없이 작동하며 (3) 추후 Edit/Generate 모드도 같은 임계 쓰면 재사용 쉬움.

#### 5.1.2 `frontend/components/studio/video/VideoSizeWarnModal.tsx` (~120줄 추정)
- Props: `open`, `width`, `height`, `onCancel`, `onConfirm`
- `simplifyRatio(w, h)` 는 `@/lib/video-size` 에서 import (5.1.1 참조)
- ESC keydown + overlay 클릭 핸들러 내장 — **`useEffect` cleanup 필수** (글로벌 listener 누수 방지):

```tsx
useEffect(() => {
  if (!open) return;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onCancel();
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [open, onCancel]);
```

> v1.3 명시 (Codex review): `UpgradeConfirmModal.tsx:77-84` 동일 패턴. `open=false` 시 early return 으로 listener 미등록 + unmount/`open` 변경 시 cleanup 호출.

Overlay 클릭은 `onClick` 핸들러에서 `e.target === e.currentTarget` 체크 (이벤트 위임 제거 — 모달 내부 클릭 가로채지 않게).

### 5.2 수정 파일

#### 5.2.1 `frontend/components/studio/video/VideoLeftPanel.tsx`

> **🔑 단일 진실원 규칙 (v1.4 · Codex review 4라운드)**: `expected` 는 `VideoLeftPanel` 안에서 **딱 한 번** `useMemo` 로 계산하고, `VideoResolutionSlider` 와 `VideoSizeWarnModal` **둘 다 prop 으로 받는다**. 슬라이더 표시값과 모달 표시값이 다른 계산 결과로 갈리는 race 를 원천 차단. 기존 슬라이더 내부 `computeVideoResize` 호출은 제거.

```ts
// useState 로 모달 노출 state.
const [warnOpen, setWarnOpen] = useState(false);

// expected — *단일 진실원*. slider + warn modal 둘 다 이 값을 사용.
// useMemo 로 sourceWidth/sourceHeight/longerEdge 변동 시만 재계산.
const expected = useMemo(() => {
  if (!sourceWidth || !sourceHeight) return { width: 0, height: 0 };
  return computeVideoResize(sourceWidth, sourceHeight, longerEdge);
}, [sourceWidth, sourceHeight, longerEdge]);

const handleCtaClick = () => {
  // 방어 가드 — overlay 가 보통 가리지만 Tab/엔터 race 안전망.
  if (running || warnOpen || ctaDisabled) return;

  if (shouldWarnVideoSize(expected.width, expected.height)) {
    setWarnOpen(true);
    return;
  }

  onGenerate();
};

const handleConfirmWarn = () => {
  // 순서 의도: 모달 먼저 닫고 → onGenerate (running=true 전환 시점에
  //   모달이 잔류하는 프레임 최소화).
  setWarnOpen(false);
  onGenerate();
};

const handleCancelWarn = () => {
  setWarnOpen(false);
};
```

- CTA 버튼 `onClick={handleCtaClick}` 로 교체
- `<VideoResolutionSlider expected={expected} ... />` 시그니처 변경 — **prop 으로 받음** (자체 계산 제거)
- `<VideoSizeWarnModal open={warnOpen} width={expected.width} height={expected.height} onConfirm={handleConfirmWarn} onCancel={handleCancelWarn} />` 마운트 (CTA 외부 sibling) — **같은 `expected` 객체** 사용

→ 사용자 의도와 같이 **`useVideoPipeline.generate` 는 변경 없음** (깨끗하게 유지). 게이팅은 UI 레벨에서만.

### 5.3 `VideoLeftPanel.tsx` 안 `simplifyRatio` 제거

기존 `function simplifyRatio(w, h)` (line 577) 삭제 후 `import { simplifyRatio } from "@/lib/video-size"` 로 교체.

---

## 6. 테스트 전략

### 6.1 vitest (frontend)

신규 테스트 파일: `frontend/__tests__/video-size-warn.test.ts(x)`

#### 6.1.1 순수 함수 테스트 — `shouldWarnVideoSize`

| 입력 (W×H) | 기대 | 케이스 |
|-----------|------|--------|
| 832×480 | false | base (임계 미만) |
| 1024×1024 | true | 둘 다 ≥ 1000 |
| 999×999 | false | 둘 다 ≥ 1000 경계 |
| 1000×1000 | true | 둘 다 ≥ 1000 경계 |
| 1280×720 | true | W ≥ 1280 |
| 720×1280 | true | H ≥ 1280 |
| 1279×999 | false | 둘 임계 미달 |
| 1280×500 | true | W = 1280 경계 |
| 0×0 | false | 가드 — 소스 미선택 |
| -100×500 | false | 가드 — 음수 |
| `NaN`×720 | false | 가드 — NaN |
| `Infinity`×720 | false | 가드 — Infinity |

#### 6.1.2 순수 함수 테스트 — `simplifyRatio` (v1.2 신규)

| 입력 (w, h) | 기대 | 케이스 |
|------------|------|--------|
| 1920, 1080 | "16:9" | 일반 |
| 1080, 1920 | "9:16" | 세로 |
| 1024, 1024 | "1:1" | 정사각 |
| 832, 480 | "26:15" | 비표준 (실제 GCD 결과) |
| 0, 0 | "-" | 가드 — 둘 다 0 |
| 1024, 0 | "-" | 가드 — 한쪽 0 |
| -100, 500 | "-" | 가드 — 음수 |
| `NaN`, 720 | "-" | 가드 — NaN |
| `Infinity`, 720 | "-" | 가드 — Infinity |
| 1920.4, 1080.4 | "16:9" | 소수 입력 (Math.round 적용 — 둘 다 내림) |
| 0.4, 0.4 | "-" | 2차 가드 — round 후 0×0 (v1.3) |
| 0.4, 1080 | "-" | 2차 가드 — round 후 한쪽만 0 (v1.3) |

#### 6.1.3 컴포넌트 테스트 — `VideoSizeWarnModal`

| 시나리오 | 검증 |
|---------|------|
| open=true 마운트 | dialog role + 타이틀 + 본문 + 두 버튼 노출 |
| `[취소]` 클릭 | `onCancel` 호출 · `onConfirm` 미호출 |
| `[그대로 진행]` 클릭 | `onConfirm` 호출 · `onCancel` 미호출 |
| ESC keydown | `onCancel` 호출 |
| Overlay 클릭 | `onCancel` 호출 |
| open=false | DOM 미렌더 |
| **open=true → unmount** | window keydown listener **제거** (v1.3 · spy 로 `removeEventListener` 호출 검증) |
| **open=true → open=false 전환** | listener 정리 (cleanup 호출) |

#### 6.1.4 통합 테스트 — `VideoLeftPanel` CTA 분기

| 시나리오 | 검증 |
|---------|------|
| 임계 미만 사이즈 + Render 클릭 | `onGenerate` 즉시 호출 · 모달 미노출 |
| 임계 충족 사이즈 + Render 클릭 | 모달 노출 · `onGenerate` 미호출 |
| 모달 `[그대로 진행]` 클릭 | 모달 닫힘 · `onGenerate` 호출 |
| 모달 `[취소]` 클릭 | 모달 닫힘 · `onGenerate` 미호출 |

### 6.2 pytest (backend)

**없음**. 백엔드 변경 0건 (`useVideoPipeline.generate` 도 변경 없음 · `videoImageStream` 그대로 호출).

### 6.3 회귀 검증

- **신규 테스트 전부 PASS + 기존 vitest regression 0** (정확한 총 수에 의존하지 않음 — 이전 작업 패턴 미러)
- `npx tsc --noEmit` clean
- `npm run lint` clean
- 브라우저 실측: 832×480 (모달 미노출 흐름) + 1536×864 (모달 노출 → 진행 / 취소 양쪽)

---

## 7. 위험 / 엣지 케이스

| # | 케이스 | 처리 |
|---|--------|------|
| 1 | `sourceImage` 없음 → expected = `{0, 0}` | 2-layer 안전망: (1) `ctaDisabled = !sourceImage` 가 먼저 작동해 클릭 자체 차단, (2) `shouldWarnVideoSize(0, 0) === false` 가드 (≤0 → false) 로 race 시점에도 안전. |
| 2 | 모달 노출 중 좌측 슬라이더 접근 시도 | 모달 overlay (`z-index: 65` · `inset: 0`) 가 좌측 패널을 가림 → 사용자는 `[취소]` 또는 `ESC` 후에만 슬라이더 조작 가능 (사용자 의도와 일치 · "단순하게"). |
| 3 | 모달 노출 중 `running` 이 다른 경로로 true → false 전환 | 현재 코드상 발생 불가 (Render 만이 trigger · CTA 가 `disabled={running}`). 안전. |
| 4 | 모달 열림 → 페이지 라우팅 | `useAutoCloseModal` 처럼 cleanup 필요 X (모달은 unmount 시 자동 제거). 안전. |
| 5 | 임계 경계값 (정확히 1000 / 1280) | 결정 §2 #1: `≥` 연산자 → 정확히 1000 도 트리거 (양쪽 임계 만족 시). 1280 도 트리거 (단일 임계 만족). 테스트 §6.1.1 에 명시. |

---

## 8. 구현 단계 (writing-plans 단계로 위임)

1. **순수 util 신설** — `frontend/lib/video-size.ts` (임계 상수 + `shouldWarnVideoSize` + `simplifyRatio` 이동)
2. **모달 컴포넌트** — `VideoSizeWarnModal.tsx` 신규
3. **CTA 분기** — `VideoLeftPanel.tsx` `expected` `useMemo` 끌어올리기 + `handleCtaClick` / `handleConfirmWarn` / `handleCancelWarn` 추가 + 모달 마운트 + 옛 `simplifyRatio` 삭제 + lib import
4. **테스트** — vitest §6.1 매트릭스 (1~3 파일 분할은 plan 단계에서 결정)
5. **검증** — vitest + tsc + lint + 브라우저 실측

---

## 9. 영향 범위 요약

| 영역 | 변경 |
|------|------|
| 백엔드 | **0건** |
| `useVideoPipeline` | **0건** (깨끗 유지) |
| `useVideoStore` | **0건** (헬퍼 별 lib 으로 분리 · v1.1 결정) |
| 신규 파일 | 2개 (`lib/video-size.ts` · `components/studio/video/VideoSizeWarnModal.tsx`) + 테스트 1~3개 |
| 수정 파일 | 1개 (`VideoLeftPanel.tsx` · `expected` 끌어올림 + CTA 분기 + 옛 `simplifyRatio` 제거) |
| pytest | **0건** (변경 없음) |
| vitest | **신규 PASS + 기존 regression 0** (총 수에 의존 X) |

---

## 10. 확장 후보 (이번 spec 범위 X)

- **Edit / Generate 모드 동일 경고** — Generate 는 1664 까지 가는데 16GB Qwen Image 가 빠르게 처리하므로 현재 필요성 낮음. 별 spec.
- **추정 시간 라벨 정밀화** — 사용자 실측 데이터 누적 (history DB) → ML 회귀 기반 ETA 표시. 별 plan.
- **dismiss 세션 기억** — 한 세션 내 같은 임계 충족 시 모달 skip. 사용자 결정 "무조건" 이라 보류.
- **컴퓨터 제원별 적응 임계** — 16GB / 24GB / 32GB VRAM 차등. 1인 환경 가정 YAGNI.
