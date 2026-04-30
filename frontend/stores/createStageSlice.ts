/**
 * createStageSlice.ts — Generate/Edit/Video 3 store 의 진행 모달 stage 추적 공통 helper.
 *
 * Phase 3 추출 (refactor doc 2026-04-30 §I3 — Codex 제안).
 *
 * 3 store 모두 동일했던 필드/액션:
 *   stageHistory / startedAt / samplingStep / samplingTotal
 *   pushStage(evt) / setSampling(step, total)
 *
 * 발산 지점 (각 store 가 자체 정의 유지):
 *   - Generate: setRunning(generating, progress, stage) — multi-arg
 *   - Edit:     setRunning(running) — single bool + extra pipeline state
 *   - Video:    setRunning(running) — Edit 과 유사
 *
 * Codex caveat:
 *   - useGenerateStore 만 persist(), Edit/Video 는 non-persist.
 *   - slice 주입 방식 단순화 — 공통 초기값 + action factory 만 export.
 */

import type { StateCreator } from "zustand";
import type { StageEvent } from "@/lib/stage";

/** 3 store 공통 stage 추적 상태 (5 필드). */
export interface StageSliceState {
  stageHistory: StageEvent[];
  /** 실행 시작 시각 (ms since epoch) — 경과 시간 계산용 */
  startedAt: number | null;
  /** ComfyUI 샘플러 현재 스텝 (예: 3) */
  samplingStep: number | null;
  /** ComfyUI 샘플러 총 스텝 (예: 40) */
  samplingTotal: number | null;
}

/** stage 추적 공통 액션 (이름/시그니처 3 store 모두 동일). */
export interface StageSliceActions {
  /** 백엔드 stage SSE 이벤트 도착 시 호출. arrivedAt 자동 부여. */
  pushStage: (evt: Omit<StageEvent, "arrivedAt">) => void;
  /** ComfyUI 샘플링 스텝 업데이트. */
  setSampling: (step: number | null, total: number | null) => void;
}

/** 공통 초기값 — store 의 create() 첫 인자에서 spread. */
export const STAGE_INITIAL_STATE: StageSliceState = {
  stageHistory: [],
  startedAt: null,
  samplingStep: null,
  samplingTotal: null,
};

/**
 * action factory — store 의 set 함수를 받아 공통 액션 객체 반환.
 *
 * 사용 예 (Generate persist + Edit/Video non-persist 모두 호환):
 *
 *   create<EditState>((set) => ({
 *     ...STAGE_INITIAL_STATE,
 *     ...createStageActions(set),
 *     // Edit 고유 필드/액션
 *   }));
 *
 * 제네릭 T 는 store 의 전체 state — set 의 시그니처 호환을 위해 필요.
 */
export function createStageActions<T extends StageSliceState>(
  set: Parameters<StateCreator<T>>[0],
): StageSliceActions {
  return {
    pushStage: (evt) =>
      set(
        (s) =>
          ({
            stageHistory: [
              ...s.stageHistory,
              { ...evt, arrivedAt: Date.now() },
            ],
          }) as Partial<T>,
      ),
    setSampling: (step, total) =>
      set(
        () =>
          ({
            samplingStep: step,
            samplingTotal: total,
          }) as Partial<T>,
      ),
  };
}
