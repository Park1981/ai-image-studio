/**
 * lib/stage.ts — 진행 모달 stage 이벤트 타입 (Generate/Edit/Video 공통).
 *
 * Phase 3 stage slice 추출 (refactor doc 2026-04-30 §I3) — 옛 위치는
 * useGenerateStore.ts 였지만 의미상 store 와 무관한 도메인 타입이라 lib/ 로 이동.
 *
 * StageEvent 는 백엔드가 보내는 stage SSE 이벤트의 클라이언트측 표현.
 * PipelineTimeline 의 StageDef.renderDetail 콜백이 payload 를 사용.
 */

export interface StageEvent {
  /** stage 식별자 (예: "gemma4-upgrade", "comfyui-sampling") — StageDef 와 매칭 */
  type: string;
  /** UI 라벨 (예: "gemma4 업그레이드") */
  label: string;
  /** 0-100 — 백엔드가 단계별로 명시 */
  progress: number;
  /** 도착 시점 (ms since epoch) — 클라이언트에서 부여 */
  arrivedAt: number;
  /** 백엔드가 보낸 추가 payload (description / finalPrompt / editVisionAnalysis 등 stage 별 detail).
   *  PipelineTimeline 의 StageDef.renderDetail 콜백이 사용. 옵셔널 — 없으면 detail 박스 안 그림. */
  payload?: Record<string, unknown>;
}
