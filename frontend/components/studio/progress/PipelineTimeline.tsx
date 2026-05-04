/**
 * PipelineTimeline — 진행 모달 통일 타임라인 (3 mode 공용 단일 컴포넌트).
 *
 * 2026-04-27 (Phase 1) 신설.
 *
 * 설계 문서: docs/superpowers/specs/2026-04-27-progress-store-unify-design.md
 *
 * 동작:
 *   - PIPELINE_DEFS[mode] 의 StageDef[] 를 enabled 콜백으로 필터링 → 표시할 row 결정
 *   - 각 store 의 stageHistory 도착 순서로 done/running/pending 판정
 *   - StageDef.renderDetail 콜백이 정의된 stage 는 row 아래 보조 박스 자동 렌더
 *
 * mode 별 store 구독:
 *   - generate: useGenerateStore (stageHistory + generating + research)
 *   - edit:    useEditStore     (stageHistory)
 *   - video:   useVideoStore    (stageHistory)
 *   - vision:  useVisionStore   (stageHistory · Phase 6 도입)
 *   - compare: useVisionCompareStore (stageHistory · Phase 6 도입)
 *
 * 5 mode 풀 통일 완료 (post-Phase-6 cleanup) — 단일 컴포넌트.
 */

"use client";

import { useEffect, useState } from "react";
import {
  PIPELINE_DEFS,
  type PipelineCtx,
  type PipelineMode,
  type StageDef,
} from "@/lib/pipeline-defs";
import { useEditStore } from "@/stores/useEditStore";
import {
  type StageEvent,
  useGenerateStore,
} from "@/stores/useGenerateStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useVideoStore } from "@/stores/useVideoStore";
import { useVisionStore } from "@/stores/useVisionStore";
import { useVisionCompareStore } from "@/stores/useVisionCompareStore";
import { TimelineRow } from "./TimelineRow";

/** Live tick 갱신 주기 (ms) — 0.1s 표시 정밀도에 맞춰 200ms 가 자연스러움. */
const LIVE_TICK_MS = 200;

export function PipelineTimeline({ mode }: { mode: PipelineMode }) {
  const { stageHistory, running } = usePipelineRuntime(mode);
  const ctx = usePipelineCtx(mode, stageHistory);

  // 표시할 stage 만 필터 (enabled 콜백 적용 — 미정의 시 항상 true)
  const order = PIPELINE_DEFS[mode].filter((d) => d.enabled?.(ctx) ?? true);

  // 도착한 stage 빠른 lookup — first-write-wins.
  // 2026-04-30 codex 후속 fix: comfyui-sampling 이 백엔드에서 progress 마다 N번 emit
  // 되는데, 옛 last-write-wins 는 마지막 progress 도착 시각만 남겨서 live elapsed 가
  // 0.2 → 0.4 식으로 떨림. 첫 도착 (= 진짜 stage 시작) 시각을 보존해야 함.
  const byType = new Map<string, StageEvent>();
  for (const s of stageHistory) {
    if (!byType.has(s.type)) byType.set(s.type, s);
  }

  // Phase 2 후속 (Codex Phase 4 리뷰 High #2) — DetailBox renderDetail 용 payload 는
  // *모든 같은-type 이벤트의 merge* 사용. edit/video prompt-merge 와 compare vision-pair
  // 는 시작 이벤트 (payload 비고) → 완료 이벤트 (finalPrompt/provider 풍부) 두 번 emit.
  // first-write-wins 만 쓰면 완료 payload 가 무시되어 fallback-precise-failed 톤 + 본문이
  // 안 보임. left-to-right merge 로 마지막 truthy 값이 우선 (빈 payload 는 no-op).
  const payloadByType = new Map<string, Record<string, unknown>>();
  for (const s of stageHistory) {
    if (!s.payload) continue;
    const cur = payloadByType.get(s.type) ?? {};
    payloadByType.set(s.type, { ...cur, ...s.payload });
  }

  const lastArrived = stageHistory[stageHistory.length - 1];

  // 마지막 도착 stage 의 order 안 인덱스 (없으면 -1)
  const arrivedIdx = lastArrived
    ? order.findIndex((o) => o.type === lastArrived.type)
    : -1;

  // 2026-04-30 fix: codex 의견 적용 — 마지막 도착 stage 를 running 으로 표시.
  //   - 옛 nextIdx 로직: arrivedIdx + 1 → 도착 즉시 done 처리, 마지막 stage RUNNING 안 뜸
  //   - 새 activeIdx 로직: running 중엔 마지막 도착 stage 가 곧 진행 중인 stage
  //   - ComfyUI sampling (60s) 처럼 stage event 1번만 emit + 다음 도착 늦은 케이스에
  //     "✅ + 시간 없음" 어색 표시 방지 → 스피너 + live elapsed 둘 다 살림.
  const activeIdx = running ? arrivedIdx : order.length;

  // running 중일 때만 매 200ms 리렌더 (live elapsed 갱신용).
  // running=false 면 interval 안 돌림 (idle CPU/리렌더 0).
  const nowTick = useNowTick(running);

  return (
    <ol
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {order.map((def, i) => {
        const arrived = byType.get(def.type);
        const { isDone, isRunning } = computeRowState({
          i,
          arrived: !!arrived,
          running,
          activeIdx,
        });
        // live elapsed 는 byType (first-write-wins) 의 첫 도착 시각 사용 — 진짜 stage 시작 기준.
        // 완료 elapsed (computeElapsedFor) 도 같은 type 중복 emit 을 견디도록 fix.
        const elapsed =
          isRunning && arrived
            ? computeLiveElapsed(arrived.arrivedAt, nowTick)
            : computeElapsedFor(stageHistory, def.type);

        return (
          <div
            key={def.type}
            style={{ display: "flex", flexDirection: "column" }}
          >
            <TimelineRow
              n={i + 1}
              label={def.label}
              // Phase 2 (2026-05-01) — subLabel 콜백 분기 (정밀 모드 라벨 변경 등)
              subLabel={
                typeof def.subLabel === "function"
                  ? def.subLabel(ctx)
                  : def.subLabel
              }
              state={isDone ? "done" : isRunning ? "running" : "pending"}
              elapsed={elapsed}
            />
            {/* StageDef.renderDetail 정의된 stage 만 — done 일 때 + payload 있을 때 + 결과 truthy 일 때.
             *  Phase 2 후속 (Codex Phase 4 리뷰 High #2): merged payload 전달 — 시작/완료 두 emit 의
             *  payload 가 합쳐진 form. 같은 type 의 마지막 truthy 값이 우선 (finalPrompt/provider 등). */}
            {isDone && def.renderDetail && arrived && (
              <DetailRenderer
                def={def}
                payload={payloadByType.get(def.type) ?? arrived.payload ?? {}}
                ctx={ctx}
              />
            )}
          </div>
        );
      })}
    </ol>
  );
}

/** running 일 때만 200ms 주기로 갱신되는 현재 시각 ms (live elapsed 전용). */
function useNowTick(running: boolean): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(Date.now()), LIVE_TICK_MS);
    return () => clearInterval(id);
  }, [running]);
  return tick;
}

/* ────────────────────────────────────────────────
 * 보조 — mode 별 store runtime + ctx 묶음
 * ──────────────────────────────────────────────── */

interface PipelineRuntime {
  stageHistory: StageEvent[];
  running: boolean;
}

/** mode 별 store 에서 stageHistory + running 가져오기.
 *  hook 규칙 위배 회피 — 모든 store 를 항상 구독하고 mode 로 분기.
 *  Phase 6 (2026-04-27): vision/compare 추가. */
function usePipelineRuntime(mode: PipelineMode): PipelineRuntime {
  const genStageHistory = useGenerateStore((s) => s.stageHistory);
  const genRunning = useGenerateStore((s) => s.generating);
  const editStageHistory = useEditStore((s) => s.stageHistory);
  const editRunning = useEditStore((s) => s.running);
  const videoStageHistory = useVideoStore((s) => s.stageHistory);
  const videoRunning = useVideoStore((s) => s.running);
  const visionStageHistory = useVisionStore((s) => s.stageHistory);
  const visionRunning = useVisionStore((s) => s.running);
  const compareStageHistory = useVisionCompareStore((s) => s.stageHistory);
  const compareRunning = useVisionCompareStore((s) => s.running);

  if (mode === "generate") {
    return { stageHistory: genStageHistory, running: genRunning };
  }
  if (mode === "edit") {
    return { stageHistory: editStageHistory, running: editRunning };
  }
  if (mode === "video") {
    return { stageHistory: videoStageHistory, running: videoRunning };
  }
  if (mode === "vision") {
    return { stageHistory: visionStageHistory, running: visionRunning };
  }
  return { stageHistory: compareStageHistory, running: compareRunning };
}

/** PipelineCtx 묶음 — mode 별로 필요한 ctx 만 채워 보냄 (다른 mode 의 값은 undefined). */
function usePipelineCtx(
  mode: PipelineMode,
  stageHistory: StageEvent[],
): PipelineCtx {
  const research = useGenerateStore((s) => s.research);
  const editAnalysis = useEditStore((s) => s.editVisionAnalysis);
  const hideEdit = useSettingsStore((s) => s.hideEditPrompts);
  const hideGen = useSettingsStore((s) => s.hideGeneratePrompts);
  const hideVideo = useSettingsStore((s) => s.hideVideoPrompts);
  // Phase 2 (2026-05-01) — mode 별 promptMode 도 ctx 에 주입.
  // gemma4-un 사용 4 stage (generate.gemma4-upgrade / edit·video.prompt-merge /
  // compare.intent-refine) 의 subLabel 콜백에서 사용.
  const genPromptMode = useGenerateStore((s) => s.promptMode);
  const editPromptMode = useEditStore((s) => s.promptMode);
  const videoPromptMode = useVideoStore((s) => s.promptMode);
  // Phase 5 follow-up (2026-05-03) — video stage 의 builder/모델 라벨 분기용.
  const videoModelId = useVideoStore((s) => s.selectedVideoModel);
  // 2026-05-04 — Vision stage 의 subLabel 동적화 (Edit/Video/Compare 의 vision-analyze).
  // settings.visionModel persist 값 그대로 — Vision 페이지에서 토글한 모델 반영.
  const visionModel = useSettingsStore((s) => s.visionModel);

  // warmup stage 가 도착했는지 — Phase 5 자동 기동 시 활성. stageHistory 안 type 검사.
  const warmupArrived = stageHistory.some((s) => s.type === "comfyui-warmup");
  // Phase 6 — compare 의 intent-refine stage 도착 여부 (Edit context 캐시 미스 시만)
  const intentRefineArrived = stageHistory.some(
    (s) => s.type === "intent-refine",
  );

  // Phase 2 (2026-05-01) — Compare 의 자동 트리거 케이스는 Edit 모드 전파됐으므로
  // editPromptMode 를 그대로 사용. 수동 Compare (Vision Compare 메뉴) 도 같은 store
  // 안 쓰지만 그 케이스는 intent-refine stage 자체 emit 안 하므로 영향 없음.
  const promptMode =
    mode === "generate"
      ? genPromptMode
      : mode === "edit"
      ? editPromptMode
      : mode === "video"
      ? videoPromptMode
      : mode === "compare"
      ? editPromptMode
      : undefined;

  return {
    research: mode === "generate" ? research : undefined,
    editVisionAnalysis: mode === "edit" ? editAnalysis : undefined,
    hideEditPrompts: mode === "edit" ? hideEdit : undefined,
    hideGeneratePrompts: mode === "generate" ? hideGen : undefined,
    hideVideoPrompts: mode === "video" ? hideVideo : undefined,
    warmupArrived,
    intentRefineArrived: mode === "compare" ? intentRefineArrived : undefined,
    promptMode,
    videoModelId: mode === "video" ? videoModelId : undefined,
    // visionModel — Edit/Video/Compare 모드만 채움 (Generate 는 vision 호출 없음, Vision 자체는 별 stage 없음).
    visionModel:
      mode === "edit" || mode === "video" || mode === "compare"
        ? visionModel
        : undefined,
  };
}

/* ────────────────────────────────────────────────
 * 보조 — elapsed 계산
 * ──────────────────────────────────────────────── */

/** 특정 stage 의 소요 시간 (다음 다른 stage 도착 시각 − 본인 첫 도착 시각).
 *
 *  2026-04-30 codex 후속 fix: comfyui-sampling 같이 progress 마다 여러 번 emit 되는
 *  type 의 elapsed 가 "progress 이벤트 사이 간격" 으로 잘못 계산되던 버그 차단.
 *    - cur = 같은 type 의 *첫* 도착 (진짜 stage 시작)
 *    - next = idx 다음의 *다른 type* 첫 도착 (다음 stage 시작)
 *  → ComfyUI sampling 60s 가 "60.5" 로 정확히 표시됨 (옛 로직: 0.3 같은 progress 간격)
 *
 *  마지막 stage (다른 type 의 다음 도착 없음) 면 null (계산 불가). */
export function computeElapsedFor(
  stageHistory: StageEvent[],
  type: string,
): string | null {
  const idx = stageHistory.findIndex((s) => s.type === type);
  if (idx < 0) return null;
  const cur = stageHistory[idx];
  // 같은 type 의 progress 이벤트는 건너뛰고 *다른 type* 의 다음 도착만 인정.
  const next = stageHistory.slice(idx + 1).find((s) => s.type !== type);
  if (!next) return null;
  return ((next.arrivedAt - cur.arrivedAt) / 1000).toFixed(1);
}

/** running 중인 stage 의 live 경과 시간 (현재 tick − 도착 시각).
 *  음수 방지 — clock skew / 직전 도착에 대비해 0 으로 clamp. */
export function computeLiveElapsed(arrivedAt: number, nowTick: number): string {
  const sec = Math.max(0, (nowTick - arrivedAt) / 1000);
  return sec.toFixed(1);
}

/** Row 별 표시 상태 결정 (테스트 가능한 순수 함수).
 *  codex 의견 (2026-04-30) — activeIdx 단순화 + arrived 가드:
 *    activeIdx = running ? arrivedIdx : order.length
 *    isRunning = running && i === activeIdx && arrived  ← codex Minor: arrived 가드
 *    isDone    = arrived && (!running || i < activeIdx)
 *
 *  arrived 가드 의의: enabled 콜백으로 필터된 order 와 stageHistory 의 race 방어.
 *  activeIdx=-1 (아직 0개 도착) 시점에도 i=-1 케이스가 안 생겨 안전. */
export function computeRowState(args: {
  i: number;
  arrived: boolean;
  running: boolean;
  activeIdx: number;
}): { isDone: boolean; isRunning: boolean } {
  const { i, arrived, running, activeIdx } = args;
  const isRunning = running && i === activeIdx && arrived;
  const isDone = arrived && (!running || i < activeIdx);
  return { isDone, isRunning };
}

/* ────────────────────────────────────────────────
 * 보조 — renderDetail 결과 wrap
 * ──────────────────────────────────────────────── */

/** StageDef.renderDetail 결과 렌더 — null 반환 시 wrapper 자체 안 그림.
 *
 *  Phase 2 후속 (Codex Phase 4 리뷰 High #2): payload 를 외부에서 받음.
 *  PipelineTimeline 이 *시작/완료 두 emit 의 payload merge* 후 전달 → 완료 단계의
 *  finalPrompt / provider 가 항상 보임 (옛 first-write-wins 한계 해소). */
function DetailRenderer({
  def,
  payload,
  ctx,
}: {
  def: StageDef;
  payload: Record<string, unknown>;
  ctx: PipelineCtx;
}) {
  if (!def.renderDetail) return null;
  const detail = def.renderDetail(payload, ctx);
  if (!detail) return null;
  return <div style={{ marginLeft: 34, marginTop: 4 }}>{detail}</div>;
}
