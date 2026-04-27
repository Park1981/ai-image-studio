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
 *   - edit:    useEditStore     (stageHistory · Phase 2 (2026-04-27) 도입 완료)
 *   - video:   useVideoStore    (stageHistory · Phase 3 도입 예정 — 그 전엔 빈 배열 폴백)
 *
 * Phase 2 시점 사용:
 *   - Generate / Edit 는 PipelineTimeline 적용 완료
 *   - Video 는 옛 VideoTimeline 유지 (Phase 3 에서 교체)
 */

"use client";

import type { HistoryMode } from "@/lib/api/types";
import {
  PIPELINE_DEFS,
  type PipelineCtx,
  type StageDef,
} from "@/lib/pipeline-defs";
import { useEditStore } from "@/stores/useEditStore";
import {
  type StageEvent,
  useGenerateStore,
} from "@/stores/useGenerateStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useVideoStore } from "@/stores/useVideoStore";
import { TimelineRow } from "./TimelineRow";

export function PipelineTimeline({ mode }: { mode: HistoryMode }) {
  const { stageHistory, running } = usePipelineRuntime(mode);
  const ctx = usePipelineCtx(mode, stageHistory);

  // 표시할 stage 만 필터 (enabled 콜백 적용 — 미정의 시 항상 true)
  const order = PIPELINE_DEFS[mode].filter((d) => d.enabled?.(ctx) ?? true);

  // 도착한 stage 빠른 lookup + 인덱스 판정
  const byType = new Map<string, StageEvent>();
  for (const s of stageHistory) byType.set(s.type, s);
  const lastArrived = stageHistory[stageHistory.length - 1];

  // 마지막 도착 stage 의 order 안 인덱스 (없으면 -1)
  const arrivedIdx = lastArrived
    ? order.findIndex((o) => o.type === lastArrived.type)
    : -1;
  // 현재 진행 중인 row 인덱스 (running 일 때만 의미)
  const nextIdx = !running
    ? order.length
    : arrivedIdx + 1 < order.length
      ? arrivedIdx + 1
      : arrivedIdx;

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
        const isDone = !!arrived && (i < nextIdx || !running);
        const isRunning = running && i === nextIdx - 1 && !isDone;
        const elapsed = computeElapsedFor(stageHistory, def.type);

        return (
          <div
            key={def.type}
            style={{ display: "flex", flexDirection: "column" }}
          >
            <TimelineRow
              n={i + 1}
              label={def.label}
              subLabel={def.subLabel}
              state={isDone ? "done" : isRunning ? "running" : "pending"}
              elapsed={elapsed}
            />
            {/* StageDef.renderDetail 정의된 stage 만 — done 일 때 + payload 있을 때 + 결과 truthy 일 때 */}
            {isDone && def.renderDetail && arrived && (
              <DetailRenderer def={def} arrived={arrived} ctx={ctx} />
            )}
          </div>
        );
      })}
    </ol>
  );
}

/* ────────────────────────────────────────────────
 * 보조 — mode 별 store runtime + ctx 묶음
 * ──────────────────────────────────────────────── */

interface PipelineRuntime {
  stageHistory: StageEvent[];
  running: boolean;
}

/** mode 별 store 에서 stageHistory + running 가져오기.
 *  Phase 2 시점: Generate / Edit 진짜 stageHistory 보유. Video 는 빈 배열 폴백 (Phase 3).
 *  hook 규칙 위배 회피 — 모든 store 를 항상 구독하고 mode 로 분기. */
function usePipelineRuntime(mode: HistoryMode): PipelineRuntime {
  const genStageHistory = useGenerateStore((s) => s.stageHistory);
  const genRunning = useGenerateStore((s) => s.generating);
  const editStageHistory = useEditStore((s) => s.stageHistory);
  const editRunning = useEditStore((s) => s.running);
  const videoRunning = useVideoStore((s) => s.running);

  if (mode === "generate") {
    return { stageHistory: genStageHistory, running: genRunning };
  }
  if (mode === "edit") {
    return { stageHistory: editStageHistory, running: editRunning };
  }
  // video — Phase 3 까지 stageHistory 없음 — 빈 배열 폴백.
  return { stageHistory: [], running: videoRunning };
}

/** PipelineCtx 묶음 — mode 별로 필요한 ctx 만 채워 보냄 (다른 mode 의 값은 undefined). */
function usePipelineCtx(
  mode: HistoryMode,
  stageHistory: StageEvent[],
): PipelineCtx {
  const research = useGenerateStore((s) => s.research);
  const editAnalysis = useEditStore((s) => s.editVisionAnalysis);
  const hideEdit = useSettingsStore((s) => s.hideEditPrompts);
  const hideGen = useSettingsStore((s) => s.hideGeneratePrompts);

  // warmup stage 가 도착했는지 — Phase 5 자동 기동 시 활성. stageHistory 안 type 검사.
  const warmupArrived = stageHistory.some((s) => s.type === "comfyui-warmup");

  return {
    research: mode === "generate" ? research : undefined,
    editVisionAnalysis: mode === "edit" ? editAnalysis : undefined,
    hideEditPrompts: mode === "edit" ? hideEdit : undefined,
    hideGeneratePrompts: mode === "generate" ? hideGen : undefined,
    warmupArrived,
  };
}

/* ────────────────────────────────────────────────
 * 보조 — elapsed 계산
 * ──────────────────────────────────────────────── */

/** 특정 stage 의 소요 시간 (다음 stage 도착 시각 − 본인 도착 시각).
 *  마지막 stage 면 null (다음이 없어서 계산 불가). */
function computeElapsedFor(
  stageHistory: StageEvent[],
  type: string,
): string | null {
  const idx = stageHistory.findIndex((s) => s.type === type);
  if (idx < 0) return null;
  const cur = stageHistory[idx];
  const next = stageHistory[idx + 1];
  if (!next) return null;
  return ((next.arrivedAt - cur.arrivedAt) / 1000).toFixed(1);
}

/* ────────────────────────────────────────────────
 * 보조 — renderDetail 결과 wrap
 * ──────────────────────────────────────────────── */

/** StageDef.renderDetail 결과 렌더 — null 반환 시 wrapper 자체 안 그림. */
function DetailRenderer({
  def,
  arrived,
  ctx,
}: {
  def: StageDef;
  arrived: StageEvent;
  ctx: PipelineCtx;
}) {
  if (!def.renderDetail) return null;
  const payload = arrived.payload ?? {};
  const detail = def.renderDetail(payload, ctx);
  if (!detail) return null;
  return <div style={{ marginLeft: 34, marginTop: 4 }}>{detail}</div>;
}
