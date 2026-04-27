/**
 * progress/Timelines — ProgressModal 의 Generate 타임라인.
 * 2026-04-27 (C2-P1-2): ProgressModal 분해 — main 파일에서 추출.
 *
 * 2026-04-27 (Phase 2/3 진행 모달 store 통일):
 *   EditTimeline / VideoTimeline 제거 → ProgressModal 에서 PipelineTimeline mode={...} 로 교체.
 *   Generate 만 옛 GenerateTimeline 유지 (Phase 4 cleanup 에서 PipelineTimeline 으로 통일 또는 wrapper 검토).
 */

"use client";

import { useGenerateStore, type StageEvent } from "@/stores/useGenerateStore";
import { TimelineRow } from "./TimelineRow";

const GEN_STAGE_ORDER = [
  { type: "prompt-parse", label: "프롬프트 해석" },
  { type: "claude-research", label: "Claude 조사 (최신 프롬프트 팁)" },
  { type: "gemma4-upgrade", label: "gemma4 업그레이드" },
  { type: "workflow-dispatch", label: "워크플로우 전달" },
  { type: "comfyui-sampling", label: "ComfyUI 샘플링" },
  { type: "postprocess", label: "후처리" },
];

/* ── Generate 타임라인 ── */
export function GenerateTimeline() {
  const stageHistory = useGenerateStore((s) => s.stageHistory);
  const generating = useGenerateStore((s) => s.generating);
  const research = useGenerateStore((s) => s.research);

  // research 모드면 claude-research stage 포함, 아니면 제외
  const order = GEN_STAGE_ORDER.filter(
    (o) => o.type !== "claude-research" || research,
  );

  // 도착한 stages 로 상태 판정
  const byType = new Map<string, StageEvent>();
  for (const s of stageHistory) byType.set(s.type, s);
  const lastArrived = stageHistory[stageHistory.length - 1];

  // 다음 단계 (현재 진행 중) 추정: order 의 순서대로 가장 최근 도착 직후
  const arrivedIdx = lastArrived
    ? order.findIndex((o) => o.type === lastArrived.type)
    : -1;
  const nextIdx = !generating
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
      {order.map((o, i) => {
        const arrived = byType.get(o.type);
        const completedAt = stageHistory.find((s) => s.type === o.type)
          ?.arrivedAt;
        const isDone = !!arrived && (i < nextIdx || !generating);
        const isRunning = generating && i === nextIdx - 1 && !isDone;
        const isRunningNow = generating && i === arrivedIdx;

        // 각 단계 소요 시간 (다음 단계 도착 시각 - 해당 단계 도착 시각)
        const nextArrived = stageHistory.find(
          (_s, idx) => idx === stageHistory.indexOf(arrived!) + 1,
        );
        const elapsed =
          completedAt && nextArrived
            ? ((nextArrived.arrivedAt - completedAt) / 1000).toFixed(1)
            : null;

        return (
          <TimelineRow
            key={o.type}
            n={i + 1}
            label={o.label}
            state={
              isDone
                ? "done"
                : isRunningNow || isRunning
                  ? "running"
                  : "pending"
            }
            elapsed={elapsed}
          />
        );
      })}
    </ol>
  );
}

/* ── Edit 타임라인은 Phase 2 (2026-04-27) 에서 PipelineTimeline mode="edit" 로 교체됨. */
/* ── Video 타임라인은 Phase 3 (2026-04-27) 에서 PipelineTimeline mode="video" 로 교체됨. */

/* TimelineRow / DetailBox 는 ./TimelineRow.tsx · ./DetailBox.tsx 로 추출됨
 * (2026-04-27 Phase 1 — PipelineTimeline 공용). */
