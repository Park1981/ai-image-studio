# 진행 모달 store 통일 설계 (옵션 B — StageDef 시스템)

**작성일**: 2026-04-27
**Branch**: `claude/progress-store-unify`
**목적**: Generate / Edit / Video 의 진행 모달이 서로 다른 패턴 (stage-기반 vs step-번호-기반) 으로 분리되어 있는 것을 **단일 StageDef 시스템**으로 통합. 미래의 stage 동적 on/off (예: gemma4 비활성화, 캐시 hit 시 단계 스킵) 와 새 stage 추가 (예: ComfyUI 자동 기동 워밍업) 비용을 최소화.

> **이 문서는 세션 끊김 대비 인계용**. 다음 세션이 이 문서만 보고 동일한 결과를 만들 수 있도록 작성됨. 코드 예시는 그대로 복붙해서 쓸 수 있는 수준 유지.

---

## 1. 배경 — 현재 분리 상태

### 1.1 백엔드 emit 패턴 (사실상 같음)
모든 파이프라인이 `task.emit("stage", {...})` 형태로 진행 이벤트를 보냄. **백엔드는 통일된 인터페이스**.

```python
# generate.py
await task.emit("stage", {"type": "prompt-parse", "progress": 10, "stageLabel": "프롬프트 해석"})

# edit.py — 단, 추가로 step 이벤트도 함께 emit (이중 트랙)
await task.emit("stage", {"type": "vision-analyze", "progress": 10, "stageLabel": "비전 분석"})
await task.emit("step", {"step": 1, "done": False})
# step 1 완료 시 description 등 의미 payload
await task.emit("step", {"step": 1, "done": True, "description": vision.image_description})
```

### 1.2 프론트 store 패턴 (분리)
- **`useGenerateStore`**: `stageHistory: StageEvent[]` — type 으로 매칭 + Timeline 의 `GEN_STAGE_ORDER` 배열에 대응
- **`useEditStore`**: `currentStep`/`stepDone`/`stepHistory[].n` — 번호 비교 (`stepDone >= n`)
- **`useVideoStore`**: 위와 동일한 step 번호 패턴

### 1.3 분리된 이유 (이해 후 통합)
Edit/Video 는 step 별로 **사용자에게 보여줄 의미 정보**가 다름:
- step 1 완료 → 비전 설명 (description) 박스
- step 2 완료 → 최종 프롬프트 (finalPrompt) + 한국어 번역 (finalPromptKo) 박스
- step 1 의 EditVisionBlock chip UI (구조 분석)

이 정보를 step-번호로 묶기가 직관적이라 자연스럽게 step 패턴으로 진화함. **통일 시 이 detail 표현력은 100% 보존해야 함** (사용자 가치).

---

## 2. 통일 후 핵심 타입

### 2.1 StageDef + PipelineCtx 시스템

```typescript
// frontend/lib/pipeline-defs.ts (신규)

import type { ReactNode } from "react";

/** 진행 모달 1 stage 의 정의. PIPELINE_DEFS 안에 mode 별로 배열로 들어감. */
export interface StageDef {
  /** SSE 의 stage event type 과 1:1 매칭 (백엔드 emit 의 "type" 필드) */
  type: string;
  /** 사용자 표시용 stage 이름 */
  label: string;
  /** 모델/엔진 정보 (선택). Edit/Video 의 step 보조 라벨 ("qwen2.5vl:7b" 등) */
  subLabel?: string;
  /** 동적 on/off — false 면 timeline 에서 row 자체 안 그림. 미정의 시 항상 표시 (true) */
  enabled?: (ctx: PipelineCtx) => boolean;
  /** stage 가 done 상태일 때 row 아래 보조 박스 렌더 (선택). vision description / finalPrompt 등 */
  renderDetail?: (payload: StagePayload, ctx: PipelineCtx) => ReactNode;
}

/** Timeline 이 enabled / renderDetail 호출 시 넘기는 컨텍스트 묶음. */
export interface PipelineCtx {
  /** Generate 의 research 토글 등 mode 별 boolean 플래그 (확장 가능) */
  research?: boolean;
  /** 자동 기동 워밍업 stage 가 도착했는지 — comfyui-warmup row 표시 게이트 */
  warmupArrived?: boolean;
  /** 차후 도입 예정: gemma4 비활성화 시 gemma4-upgrade stage 숨김 */
  gemma4Off?: boolean;
  /** mode 별 휘발 분석 데이터 (예: editVisionAnalysis chip) */
  editVisionAnalysis?: unknown;
  /** ProgressModal 의 prompt 토글 (hideEditPrompts 등) */
  hideEditPrompts?: boolean;
  hideGeneratePrompts?: boolean;
}

/** 백엔드가 SSE 로 보내는 stage event payload 의 임의 필드. */
export type StagePayload = Record<string, unknown>;
```

### 2.2 PIPELINE_DEFS — 진실의 출처 (single source of truth)

```typescript
// frontend/lib/pipeline-defs.ts (계속)

import type { HistoryMode } from "@/lib/api/types";
import EditVisionBlock from "@/components/studio/EditVisionBlock";
import { DetailBox } from "@/components/studio/progress/DetailBox";

export const PIPELINE_DEFS: Record<HistoryMode, StageDef[]> = {
  // ── Generate (6 stage · 기존 GEN_STAGE_ORDER 와 1:1 매칭) ──
  generate: [
    { type: "prompt-parse", label: "프롬프트 해석" },
    {
      type: "claude-research",
      label: "Claude 조사",
      subLabel: "최신 프롬프트 팁",
      enabled: (c) => c.research === true,
    },
    { type: "gemma4-upgrade", label: "gemma4 업그레이드", subLabel: "프롬프트 강화" },
    { type: "workflow-dispatch", label: "워크플로우 전달" },
    {
      type: "comfyui-warmup",
      label: "ComfyUI 깨우는 중",
      subLabel: "최대 30초",
      enabled: (c) => c.warmupArrived === true, // 자동 기동 시에만 노출
    },
    { type: "comfyui-sampling", label: "ComfyUI 샘플링" },
    { type: "postprocess", label: "후처리" },
  ],

  // ── Edit (5 stage · 기존 4 step 매핑) ──
  edit: [
    {
      type: "vision-analyze",
      label: "비전 분석",
      subLabel: "qwen2.5vl:7b",
      renderDetail: (p, c) => {
        // 구조 분석 (editVisionAnalysis) 있으면 chip UI, 없으면 단락
        if (c.editVisionAnalysis && !c.hideEditPrompts) {
          return <EditVisionBlock analysis={c.editVisionAnalysis as never} showHeader={false} />;
        }
        if (typeof p.description === "string" && !c.hideEditPrompts) {
          return <DetailBox kind="info" title="비전 설명">{p.description}</DetailBox>;
        }
        return null;
      },
    },
    {
      type: "comfyui-warmup",
      label: "ComfyUI 깨우는 중",
      subLabel: "최대 30초",
      enabled: (c) => c.warmupArrived === true,
    },
    {
      type: "prompt-merge",
      label: "프롬프트 통합",
      subLabel: "gemma4-un",
      renderDetail: (p, c) => {
        if (c.hideEditPrompts) return null;
        const fp = p.finalPrompt as string | undefined;
        const fpKo = p.finalPromptKo as string | undefined;
        const provider = p.provider as string | undefined;
        return (
          <>
            {fp && (
              <DetailBox kind={provider === "fallback" ? "warn" : "info"} title={`최종 프롬프트 (${provider})`}>
                {fp}
              </DetailBox>
            )}
            {fpKo && <DetailBox kind="muted" title="한국어 번역">{fpKo}</DetailBox>}
          </>
        );
      },
    },
    { type: "param-extract", label: "사이즈/스타일 추출", subLabel: "auto" },
    { type: "comfyui-sampling", label: "ComfyUI 샘플링", subLabel: "qwen-image-edit-2511" },
    { type: "save-output", label: "결과 저장" },
  ],

  // ── Video (6 stage · 기존 5 step 매핑) ──
  video: [
    {
      type: "vision-analyze",
      label: "이미지 비전 분석",
      subLabel: "qwen2.5vl:7b",
      renderDetail: (p) => {
        const desc = p.description as string | undefined;
        return desc ? <DetailBox kind="info" title="비전 설명">{desc}</DetailBox> : null;
      },
    },
    {
      type: "comfyui-warmup",
      label: "ComfyUI 깨우는 중",
      subLabel: "최대 30초",
      enabled: (c) => c.warmupArrived === true,
    },
    {
      type: "prompt-merge",
      label: "영상 프롬프트 통합",
      subLabel: "gemma4-un",
      renderDetail: (p) => {
        const fp = p.finalPrompt as string | undefined;
        const fpKo = p.finalPromptKo as string | undefined;
        const provider = p.provider as string | undefined;
        return (
          <>
            {fp && <DetailBox kind={provider === "fallback" ? "warn" : "info"} title={`LTX 프롬프트 (${provider})`}>{fp}</DetailBox>}
            {fpKo && <DetailBox kind="muted" title="한국어 번역">{fpKo}</DetailBox>}
          </>
        );
      },
    },
    { type: "workflow-build", label: "워크플로우 구성", subLabel: "LTX i2v builder" },
    { type: "comfyui-sampling", label: "ComfyUI 샘플링", subLabel: "ltx-2.3-22b-fp8" },
    { type: "save-output", label: "MP4 저장", subLabel: "h264 인코딩" },
  ],
};
```

**핵심 약속**: 백엔드 emit 의 `type` 값 = 이 배열의 `StageDef.type` 값. 동기화 누락 시 row 안 보임 (= 검증 게이트로 잡음).

### 2.3 통일된 Pipeline Store

```typescript
// frontend/stores/usePipelineStore.ts (신규 — 또는 useGenerateStore 확장 후 mode 별로 instance)

import { create } from "zustand";

export interface StageEvent {
  type: string;
  progress: number;
  stageLabel?: string;
  arrivedAt: number;
  /** 백엔드가 보낸 임의 payload (description, finalPrompt 등) */
  payload?: Record<string, unknown>;
}

export interface PipelineState {
  running: boolean;
  startedAt: number | null;
  /** 백엔드 누적 progress (0~100) — StatusBar 의 % 표시용 */
  progress: number;
  /** Stage 도착 이력 — Timeline 이 도착 순서로 done/running/pending 판정 */
  stageHistory: StageEvent[];
  /** 가장 마지막 stage 의 라벨 (StatusBar 의 "현재 단계" 표기) */
  pipelineLabel: string;
  /** ComfyUI 샘플링 step (실시간 percent 와 별도) */
  samplingStep: number | null;
  samplingTotal: number | null;
}
```

mode 별 store 는 이 인터페이스를 공유. mode 별 고유 필드 (예: Edit 의 `editVisionAnalysis`, Video 의 `adultMode`) 는 별도 슬라이스로 분리.

---

## 3. PipelineTimeline 컴포넌트

```typescript
// frontend/components/studio/progress/PipelineTimeline.tsx (신규)

"use client";

import type { HistoryMode } from "@/lib/api/types";
import { PIPELINE_DEFS, type PipelineCtx, type StageDef } from "@/lib/pipeline-defs";
import { useEditStore } from "@/stores/useEditStore";
import { useGenerateStore } from "@/stores/useGenerateStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useVideoStore } from "@/stores/useVideoStore";
import { TimelineRow } from "./TimelineRow"; // 기존 Timelines.tsx 에서 추출 (공용)

export function PipelineTimeline({ mode }: { mode: HistoryMode }) {
  // mode 별 store 에서 stageHistory + ctx 묶음 가져오기
  const ctx = usePipelineCtx(mode);
  const stageHistory = usePipelineStageHistory(mode);
  const running = usePipelineRunning(mode);

  const order = PIPELINE_DEFS[mode].filter((d) => d.enabled?.(ctx) ?? true);

  // 도착한 stage 인덱스 (timeline 진행률 판정)
  const byType = new Map(stageHistory.map((s) => [s.type, s]));
  const lastArrived = stageHistory[stageHistory.length - 1];
  const arrivedIdx = lastArrived ? order.findIndex((o) => o.type === lastArrived.type) : -1;
  const nextIdx = !running ? order.length : Math.min(arrivedIdx + 1, order.length);

  return (
    <ol style={{ /* ... 기존 스타일 그대로 ... */ }}>
      {order.map((def, i) => {
        const arrived = byType.get(def.type);
        const isDone = !!arrived && (i < nextIdx || !running);
        const isRunning = running && i === nextIdx - 1 && !isDone;
        const elapsed = computeElapsed(stageHistory, def.type);

        return (
          <div key={def.type}>
            <TimelineRow
              n={i + 1}
              label={def.label}
              subLabel={def.subLabel}
              state={isDone ? "done" : isRunning ? "running" : "pending"}
              elapsed={elapsed}
            />
            {/* stage 별 detail 박스 — done 일 때만 + StageDef.renderDetail 정의된 경우만 */}
            {isDone && def.renderDetail && arrived?.payload && (
              <div style={{ marginLeft: 34, marginTop: 4 }}>
                {def.renderDetail(arrived.payload, ctx)}
              </div>
            )}
          </div>
        );
      })}
    </ol>
  );
}

// mode 별 ctx 묶음 — 각 store 직접 구독
function usePipelineCtx(mode: HistoryMode): PipelineCtx {
  const research = useGenerateStore((s) => s.research);
  const editAnalysis = useEditStore((s) => s.editVisionAnalysis);
  const hideEdit = useSettingsStore((s) => s.hideEditPrompts);
  const hideGen = useSettingsStore((s) => s.hideGeneratePrompts);
  // warmup 도착 여부 — stageHistory 에서 type==="comfyui-warmup" 있는지 검사
  const warmupArrived = useWarmupArrived(mode);

  return {
    research: mode === "generate" ? research : undefined,
    editVisionAnalysis: mode === "edit" ? editAnalysis : undefined,
    hideEditPrompts: mode === "edit" ? hideEdit : undefined,
    hideGeneratePrompts: mode === "generate" ? hideGen : undefined,
    warmupArrived,
  };
}
```

`useGenerateStore` / `useEditStore` / `useVideoStore` 를 hook 안에서 분기 구독 → mode 별 컴포넌트 분기 없이 단일 컴포넌트. `mode === "edit"` 인데 `useGenerateStore.research` 구독해도 무해 (값 안 씀).

**ProgressModal 의 사용 면**:
```tsx
// 기존
{mode === "generate" ? <GenerateTimeline /> : mode === "edit" ? <EditTimeline /> : <VideoTimeline />}

// 통일 후
<PipelineTimeline mode={mode} />
```

---

## 4. 백엔드 emit 통일

### 4.1 변경 원칙
- `task.emit("stage", {...})` 만 사용 (이중 트랙 제거)
- step 이벤트 폐기 (Edit/Video 도 `step` 안 보냄). step-번호 의존 제거.
- stage 의 payload 안에 detail 정보 포함:

```python
# Edit step 1 완료 (현재)
await task.emit("step", {"step": 1, "done": True, "description": vision.image_description})

# 통일 후
await task.emit("stage", {
    "type": "vision-analyze",
    "progress": 30,
    "stageLabel": "비전 분석 완료",
    "description": vision.image_description,           # ← payload 에 흡수
    "editVisionAnalysis": _analysis.to_dict() if _analysis else None,
})
```

### 4.2 Edit/Video pipeline 변경 요약
| 단계 | 현재 emit | 통일 후 emit |
|------|-----------|--------------|
| 1 진입 | `stage(vision-analyze, 10) + step(1, false)` | `stage(vision-analyze, 10)` |
| 1 완료 | `step(1, true, description=...)` + `stage(vision-analyze, 30)` | `stage(vision-analyze, 30, description=...)` |
| 2 진입 | `stage(prompt-merge, 40) + step(2, false)` | `stage(prompt-merge, 40)` |
| 2 완료 | `step(2, true, finalPrompt=..., finalPromptKo=..., provider=...)` + `stage(prompt-merge, 50)` | `stage(prompt-merge, 50, finalPrompt=..., finalPromptKo=..., provider=...)` |
| ... | ... | ... |

Generate 는 이미 통일된 패턴 (변경 0).

### 4.3 SSE 클라이언트 (consumePipelineStream) 변경
`frontend/hooks/usePipelineStream.ts` (또는 동등 위치) 의 stage handler 가 payload 의 임의 필드를 store 의 stageHistory[].payload 로 흘려 보내도록 수정. step 이벤트는 무시 (또는 호환을 위해 그대로 두되 마이그레이션 후 제거).

---

## 5. 자동 기동 stage 추가 — 통일 후의 모습

**백엔드** (`_dispatch.py` 의 `_dispatch_to_comfy` 진입 직후):
```python
async def _ensure_comfyui_ready(task: Task, progress_at: int) -> None:
    """ComfyUI 가 꺼져 있으면 깨우면서 진행 모달에 알린다."""
    if _proc_mgr is None:
        return  # 테스트 환경
    if await _proc_mgr.check_comfyui():
        return  # 이미 떠 있음
    await task.emit("stage", {
        "type": "comfyui-warmup",
        "progress": progress_at,
        "stageLabel": "ComfyUI 깨우는 중 (~30초)",
    })
    started = await _proc_mgr.start_comfyui()
    if not started:
        raise RuntimeError("ComfyUI 시작 실패")
```

`_dispatch_to_comfy` 의 `acquire_gpu_slot` 직전에 호출. 모드 별 progress_at 은 Generate=68 / Edit=68 / Video=68 (기존 70 직전 살짝 앞).

**프론트** — 이미 PIPELINE_DEFS 에 `comfyui-warmup` 정의되어 있음. `enabled: (c) => c.warmupArrived` → store 의 stageHistory 에 type==="comfyui-warmup" 있을 때 자동 표시. **추가 코드 0**.

이게 옵션 B 의 진짜 가치 — 자동 기동 도입이 거의 무료.

---

## 6. 마이그레이션 순서 (Phase 분리)

### Phase 1 — 기반 시스템 (~2.5h)
- [ ] `frontend/lib/pipeline-defs.ts` 신설 (StageDef, PipelineCtx, PIPELINE_DEFS)
- [ ] `frontend/components/studio/progress/PipelineTimeline.tsx` 신설
- [ ] `frontend/components/studio/progress/DetailBox.tsx` 추출 (기존 Timelines.tsx 의 DetailBox)
- [ ] `frontend/components/studio/progress/TimelineRow.tsx` 추출 (기존 Timelines.tsx 의 TimelineRow)
- [ ] 백엔드 `edit.py` / `video.py` 의 step emit 폐기 + stage payload 에 detail 흡수
- [ ] 검증 — pytest 201/201 + tsc clean + lint clean
- [ ] **Commit + Push**: "refactor(progress): StageDef 시스템 + PipelineTimeline 도입 (Phase 1)"

### Phase 2 — Edit 마이그레이션 (~1.5h)
- [ ] `useEditStore` 의 stepDone/currentStep/stepHistory 제거 + stageHistory 도입
- [ ] `useEditPipeline` (SSE 클라이언트) 가 stage 이벤트만 처리 + payload 흡수
- [ ] `ProgressModal.tsx` 의 useComfyInterruptAvailability 가 lastStage === "comfyui-sampling" 으로 판정 (Edit 도)
- [ ] `app/edit/page.tsx` 의 EditTimeline 사용 → PipelineTimeline 으로 교체
- [ ] 실 동작 확인 (사용자 협력) — Edit 한 번 + 진행 모달 표시 확인 + 결과 정상 + 비교 슬라이더 정상
- [ ] **Commit + Push**: "refactor(progress): Edit store 통일 (Phase 2)"

### Phase 3 — Video 마이그레이션 (~1.5h)
- [ ] `useVideoStore` 동일 패턴 마이그레이션
- [ ] `useVideoPipeline` 동일 처리
- [ ] `app/video/page.tsx` PipelineTimeline 적용
- [ ] 실 동작 확인 — Video 한 번 (LTX 5분 작업이라 시간 들어감)
- [ ] **Commit + Push**: "refactor(progress): Video store 통일 (Phase 3)"

### Phase 4 — 정리 + Master 머지 (~1h)
- [ ] 기존 `progress/Timelines.tsx` 의 GenerateTimeline/EditTimeline/VideoTimeline 제거 (또는 PipelineTimeline 호출하는 thin wrapper 만 유지)
- [ ] `useGenerateStore` 의 stage/stageHistory 가 통일 인터페이스에 맞게 정렬 (별도 작업 거의 없음)
- [ ] 옛 `step` SSE 핸들러 dead code 제거
- [ ] pytest 회귀 + 실 동작 3 mode 모두 한 번씩
- [ ] **Master merge** — `git checkout master && git merge --no-ff claude/progress-store-unify`
- [ ] CLAUDE.md 업데이트 (Phase 4 본문 + Rules)

### Phase 5 — 자동 기동 도입 (~1h, 별도 세션 가능)
- [ ] `backend/studio/pipelines/_dispatch.py` 에 `_ensure_comfyui_ready` 추가
- [ ] `_dispatch_to_comfy` 진입부에서 호출
- [ ] PIPELINE_DEFS 의 comfyui-warmup `enabled` 검증 (이미 정의됨)
- [ ] pytest 추가: ComfyUI 꺼진 상태에서 generate 호출 → 자동 기동 + warmup stage emit 확인
- [ ] 실 동작 확인 — 백엔드 idle 11분 + 생성 호출
- [ ] **Master merge**

---

## 7. 안전장치

### 7.1 검증 게이트 (각 Phase 끝마다)
- `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/` → 201/201
- `cd frontend && npm run lint` → clean
- `cd frontend && npx tsc --noEmit` → clean
- 사용자 실 동작 확인 (다음 Phase 가기 전)

### 7.2 Rollback 절차
- Phase 별 commit 분리 → 문제 발견 시 `git revert <phase-N-commit>`
- master 머지는 Phase 4 끝에서만 → 그 전에 문제 발견되면 branch 자체 폐기 가능
- DB 영향 0 (history 테이블 step/stage 미저장 확인 — 안전)

### 7.3 잠재 함정
1. **stage payload 가 임의 dict** → TypeScript any/unknown 처리 필수. StagePayload 타입에 `Record<string, unknown>` 강제.
2. **mock.patch 위치 = lookup 모듈 기준** (메모리 규칙) — emit 패턴 변경 시 pytest 의 patch site 갱신 필수. 특히 `studio.pipelines.edit` / `studio.pipelines.video` 의 `task.emit` 가 호출되는 위치 확인.
3. **EditVisionBlock chip 보존** — Phase 1 의 PIPELINE_DEFS edit 의 `vision-analyze` renderDetail 이 이걸 그대로 호출. 시각 회귀 0 보장 필수.
4. **interrupt 가능 여부 판정** — 기존 `currentStep === 4` (Edit/Video) 가 `lastStage === "comfyui-sampling"` 으로 변경. ProgressModal 의 useComfyInterruptAvailability 같이 수정.
5. **ComparisonAnalysis 자동 트리거** (`useComparisonAnalysis` hook) 가 stepDone 의존성 있는지 확인 — Edit 결과 done 이벤트 의존이라 영향 없을 가능성 높지만 검증 필수.

### 7.4 세션 끊김 대비
- 이 문서가 진실의 출처. 다음 세션이 이 문서만 보고 동일 결과 가능.
- `MEMORY.md` + `project_session_2026_04_27_progress_unify_plan.md` 도 인계 정보 보유.
- branch `claude/progress-store-unify` 가 진행 상태 보존. 마지막 commit 이 어느 Phase 인지 확인 후 다음 Phase 진입.

---

## 8. 파일 수정 영향 (예상)

### 신규 (~5 파일)
- `frontend/lib/pipeline-defs.ts`
- `frontend/components/studio/progress/PipelineTimeline.tsx`
- `frontend/components/studio/progress/TimelineRow.tsx` (기존 추출)
- `frontend/components/studio/progress/DetailBox.tsx` (기존 추출)
- `docs/superpowers/specs/2026-04-27-progress-store-unify-design.md` (이 문서)

### 수정 (~12 파일)
- 백엔드: `studio/pipelines/edit.py` / `studio/pipelines/video.py` (emit 통일 + Phase 5 에서 `_dispatch.py`)
- 프론트:
  - `stores/useGenerateStore.ts` (stage payload 도입 — 이미 stageHistory 있어서 가벼움)
  - `stores/useEditStore.ts` (stepDone/currentStep 제거 + stageHistory 도입)
  - `stores/useVideoStore.ts` (동일)
  - `hooks/usePipelineStream.ts` (또는 mode 별 useEditPipeline / useVideoPipeline) — stage payload 흡수
  - `components/studio/ProgressModal.tsx` (PipelineTimeline 사용 + useComfyInterruptAvailability lastStage 기반 판정)
  - `components/studio/progress/Timelines.tsx` (Phase 4 에 thin wrapper 만 남기거나 제거)
  - `app/edit/page.tsx` (Timeline 사용처 변경 — 거의 변경 없을 수도)
  - `app/video/page.tsx` (동일)

### 영향 없음 (검증)
- DB 스키마
- 히스토리 데이터 (옛 row + 신규 row 모두 호환)
- 비교 분석 (`useComparisonAnalysis`) — Edit 결과 done 이벤트 의존이라 무영향 (검증 필수)
- BeforeAfter 슬라이더 — sourceRef 기반이라 무영향
- ComfyUI 워크플로우 / 비전 / 프롬프트 파이프라인 자체 (백엔드 emit 의 메타데이터만 변경)

---

## 9. 차후 확장 시나리오 (옵션 B 의 가치 검증)

### 9.1 gemma4 비활성화
```typescript
// PIPELINE_DEFS.generate 의 gemma4-upgrade 항목
{ type: "gemma4-upgrade", label: "gemma4 업그레이드", enabled: (c) => !c.gemma4Off },
// edit.prompt-merge / video.prompt-merge 도 동일하게 enabled 추가
```
+ `useSettingsStore` 에 `gemma4Off: boolean` 토글 + `usePipelineCtx` 에 추가. **3 mode 자동 일관**.

### 9.2 캐시 hit 시 단계 스킵
백엔드가 stage emit 안 하면 프론트는 자동으로 "도착 안 한 stage" 로 인식 → 그 단계가 0 elapsed 로 빠르게 지나감. 별도 enabled 불필요.

### 9.3 새 mode 추가 (예: Upscale 모드)
```typescript
PIPELINE_DEFS.upscale = [
  { type: "upscale-load", label: "업스케일 모델 로드" },
  { type: "comfyui-warmup", label: "ComfyUI 깨우는 중", enabled: (c) => c.warmupArrived },
  { type: "comfyui-sampling", label: "ComfyUI 샘플링", subLabel: "ESRGAN x2" },
];
```
+ `<PipelineTimeline mode="upscale" />` 사용. 새 timeline 컴포넌트 생성 0.

### 9.4 신규 stage 추가 (예: VRAM 정리)
```typescript
{ type: "vram-cleanup", label: "VRAM 정리", enabled: (c) => c.vramCleanup },
```
한 줄. 백엔드 emit 한 줄. 끝.

---

**END — 이 문서가 작업 진실의 출처. 다음 세션이 첫 Phase 부터 이어가도록 충분 정보 포함.**
