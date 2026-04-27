/**
 * progress/Timelines — ProgressModal 의 3 모드별 타임라인 + TimelineRow + DetailBox.
 * 2026-04-27 (C2-P1-2): ProgressModal 분해 — main 파일에서 추출.
 *
 * Generate (6 stage) / Edit (4 step) / Video (5 step) 각각 store 직접 구독.
 * TimelineRow + DetailBox 는 3 모드 공유.
 */

"use client";

import EditVisionBlock from "@/components/studio/EditVisionBlock";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";
import { useEditStore } from "@/stores/useEditStore";
import { useGenerateStore, type StageEvent } from "@/stores/useGenerateStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useVideoStore } from "@/stores/useVideoStore";

const GEN_STAGE_ORDER = [
  { type: "prompt-parse", label: "프롬프트 해석" },
  { type: "claude-research", label: "Claude 조사 (최신 프롬프트 팁)" },
  { type: "gemma4-upgrade", label: "gemma4 업그레이드" },
  { type: "workflow-dispatch", label: "워크플로우 전달" },
  { type: "comfyui-sampling", label: "ComfyUI 샘플링" },
  { type: "postprocess", label: "후처리" },
];

const EDIT_STEP_META = [
  {
    n: 1,
    label: "비전 분석",
    model: "qwen2.5vl:7b",
    desc: "이미지를 모델이 해석해서 설명 생성",
  },
  {
    n: 2,
    label: "프롬프트 통합",
    model: "gemma4-un",
    desc: "비전 설명 + 수정 요청 → 최종 프롬프트",
  },
  {
    n: 3,
    label: "사이즈/스타일 추출",
    model: "auto",
    desc: "원본 해상도 + 스타일 파라미터 자동",
  },
  {
    n: 4,
    label: "ComfyUI 실행",
    model: "qwen-image-edit-2511",
    desc: "Lightning 4-step (or 표준 40-step)",
  },
] as const;

const VIDEO_STEP_META = [
  {
    n: 1,
    label: "이미지 비전 분석",
    model: "qwen2.5vl:7b",
    desc: "원본 이미지를 모델이 해석해서 설명 생성",
  },
  {
    n: 2,
    label: "영상 프롬프트 통합",
    model: "gemma4-un",
    desc: "비전 설명 + 영상 지시 → LTX 프롬프트",
  },
  {
    n: 3,
    label: "워크플로우 구성",
    model: "LTX i2v builder",
    desc: "38-node flat API 형식 구성",
  },
  {
    n: 4,
    label: "ComfyUI 샘플링",
    model: "ltx-2.3-22b-fp8",
    desc: "base + upscale 2-stage 샘플링",
  },
  {
    n: 5,
    label: "MP4 저장",
    model: "CreateVideo + SaveVideo",
    desc: "h264 인코딩 후 서버 저장",
  },
] as const;

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

/* ── Edit 타임라인 ── */
export function EditTimeline() {
  const running = useEditStore((s) => s.running);
  const stepDone = useEditStore((s) => s.stepDone);
  const currentStep = useEditStore((s) => s.currentStep);
  const stepHistory = useEditStore((s) => s.stepHistory);
  // 백엔드가 계산한 전체 파이프라인 진행률 (0~100) — 상단 얇은 바로 표시
  const pipelineProgress = useEditStore((s) => s.pipelineProgress);
  const pipelineLabel = useEditStore((s) => s.pipelineLabel);
  // Phase 1 (2026-04-25): step 1 의 구조 분석 (휘발). 있으면 단락 대신 칩 UI.
  const editVisionAnalysis = useEditStore((s) => s.editVisionAnalysis);
  // 진행 모달 prompt 토글 (2026-04-25 후속). true 면 step detail 박스 안 그림.
  const hideEditPrompts = useSettingsStore((s) => s.hideEditPrompts);

  return (
    <>
      {/* 전체 진행 % — Step 4 ComfyUI 샘플링 중에도 실시간으로 움직임 */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--ink-3)",
            marginBottom: 4,
          }}
        >
          <span style={{ letterSpacing: 0 }}>
            {pipelineLabel || (running ? "대기" : "-")}
          </span>
          <span className="mono" style={{ letterSpacing: ".04em" }}>
            {pipelineProgress}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: "var(--line-2)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, pipelineProgress))}%`,
              background: "var(--accent)",
              transition: "width .25s ease",
            }}
          />
        </div>
      </div>
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
        {EDIT_STEP_META.map((m) => {
          const detail = stepHistory.find((x) => x.n === m.n);
          const isDone = stepDone >= m.n;
          const isRunning = running && currentStep === m.n && !isDone;

          const elapsed =
            detail?.startedAt && detail?.doneAt
              ? ((detail.doneAt - detail.startedAt) / 1000).toFixed(1)
              : null;

          return (
            <div key={m.n} style={{ display: "flex", flexDirection: "column" }}>
              <TimelineRow
                n={m.n}
                label={m.label}
                subLabel={m.model}
                state={isDone ? "done" : isRunning ? "running" : "pending"}
                elapsed={elapsed}
              />
              {/* step 1 비전 설명 —
                   Phase 1 (2026-04-25): 구조 분석 있으면 칩 UI, 없으면 기존 단락.
                   hideEditPrompts=true 면 안 그림 (깔끔 모드). */}
              {!hideEditPrompts && m.n === 1 && isDone && editVisionAnalysis ? (
                <div style={{ marginLeft: 34, marginTop: 4 }}>
                  <EditVisionBlock
                    analysis={editVisionAnalysis}
                    showHeader={false}
                  />
                </div>
              ) : !hideEditPrompts && m.n === 1 && detail?.description && isDone ? (
                <DetailBox kind="info" title="비전 설명">
                  {detail.description}
                </DetailBox>
              ) : null}
              {/* step 2 최종 프롬프트 (영문) — hideEditPrompts 분기 */}
              {!hideEditPrompts && m.n === 2 && detail?.finalPrompt && isDone && (
                <DetailBox
                  kind={detail.provider === "fallback" ? "warn" : "info"}
                  title={`최종 프롬프트 (${detail.provider})`}
                >
                  {detail.finalPrompt}
                </DetailBox>
              )}
              {/* step 2 한국어 번역 — hideEditPrompts 분기 */}
              {!hideEditPrompts && m.n === 2 && detail?.finalPromptKo && isDone && (
                <DetailBox kind="muted" title="한국어 번역">
                  {detail.finalPromptKo}
                </DetailBox>
              )}
            </div>
          );
        })}
      </ol>
    </>
  );
}

/* ── Video 타임라인 (5-step · LTX-2.3 i2v) ── */
export function VideoTimeline() {
  const running = useVideoStore((s) => s.running);
  const stepDone = useVideoStore((s) => s.stepDone);
  const currentStep = useVideoStore((s) => s.currentStep);
  const stepHistory = useVideoStore((s) => s.stepHistory);
  const pipelineProgress = useVideoStore((s) => s.pipelineProgress);
  const pipelineLabel = useVideoStore((s) => s.pipelineLabel);

  return (
    <>
      {/* 전체 진행 % — Step 4 ComfyUI 2-stage 샘플링 중에도 실시간으로 움직임 */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--ink-3)",
            marginBottom: 4,
          }}
        >
          <span style={{ letterSpacing: 0 }}>
            {pipelineLabel || (running ? "대기" : "-")}
          </span>
          <span className="mono" style={{ letterSpacing: ".04em" }}>
            {pipelineProgress}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: "var(--line-2)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, pipelineProgress))}%`,
              background: "var(--accent)",
              transition: "width .25s ease",
            }}
          />
        </div>
      </div>
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
        {VIDEO_STEP_META.map((m) => {
          const detail = stepHistory.find((x) => x.n === m.n);
          const isDone = stepDone >= m.n;
          const isRunning = running && currentStep === m.n && !isDone;

          const elapsed =
            detail?.startedAt && detail?.doneAt
              ? ((detail.doneAt - detail.startedAt) / 1000).toFixed(1)
              : null;

          return (
            <div key={m.n} style={{ display: "flex", flexDirection: "column" }}>
              <TimelineRow
                n={m.n}
                label={m.label}
                subLabel={m.model}
                state={isDone ? "done" : isRunning ? "running" : "pending"}
                elapsed={elapsed}
              />
              {/* step 1 비전 설명 */}
              {m.n === 1 && detail?.description && isDone && (
                <DetailBox kind="info" title="비전 설명">
                  {detail.description}
                </DetailBox>
              )}
              {/* step 2 최종 LTX 프롬프트 (영문) */}
              {m.n === 2 && detail?.finalPrompt && isDone && (
                <DetailBox
                  kind={detail.provider === "fallback" ? "warn" : "info"}
                  title={`LTX 프롬프트 (${detail.provider})`}
                >
                  {detail.finalPrompt}
                </DetailBox>
              )}
              {/* step 2 한국어 번역 */}
              {m.n === 2 && detail?.finalPromptKo && isDone && (
                <DetailBox kind="muted" title="한국어 번역">
                  {detail.finalPromptKo}
                </DetailBox>
              )}
            </div>
          );
        })}
      </ol>
    </>
  );
}

/* ── 단일 타임라인 row ── */
function TimelineRow({
  n,
  label,
  subLabel,
  state,
  elapsed,
}: {
  n: number;
  label: string;
  subLabel?: string;
  state: "pending" | "running" | "done" | "error";
  elapsed: string | null;
}) {
  const bulletStyle = {
    width: 22,
    height: 22,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    border:
      state === "done"
        ? "1.5px solid var(--green)"
        : state === "running"
          ? "1.5px solid var(--accent)"
          : "1.5px solid var(--line-2)",
    background:
      state === "done"
        ? "var(--green)"
        : state === "running"
          ? "#fff"
          : "#fff",
    color: "#fff",
  } as const;

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 0",
      }}
    >
      <span style={bulletStyle}>
        {state === "done" ? (
          <Icon name="check" size={12} stroke={2.5} />
        ) : state === "running" ? (
          <Spinner size={10} color="var(--accent)" />
        ) : (
          <span
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              fontWeight: 600,
            }}
          >
            {n}
          </span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: state === "pending" ? "var(--ink-4)" : "var(--ink)",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          {label}
          {subLabel && (
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                letterSpacing: ".04em",
              }}
            >
              {subLabel}
            </span>
          )}
        </div>
      </div>
      {elapsed && (
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--ink-3)",
            letterSpacing: ".04em",
          }}
        >
          {elapsed}s
        </span>
      )}
      {state === "running" && (
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--accent)",
            letterSpacing: ".04em",
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        >
          RUNNING
        </span>
      )}
    </li>
  );
}

/* ── 상세 정보 박스 (비전 설명 · 최종 프롬프트 · 번역) ── */
function DetailBox({
  kind,
  title,
  children,
}: {
  kind: "info" | "warn" | "muted";
  title: string;
  children: React.ReactNode;
}) {
  const bg =
    kind === "warn"
      ? "var(--amber-soft)"
      : kind === "muted"
        ? "var(--surface)"
        : "var(--bg-2)";
  const border =
    kind === "warn"
      ? "rgba(250,173,20,.35)"
      : kind === "muted"
        ? "var(--line)"
        : "var(--line)";
  return (
    <div
      style={{
        marginLeft: 34,
        marginTop: 4,
        padding: "10px 12px",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "var(--radius-sm)",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: ".06em",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-2)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {children}
      </div>
    </div>
  );
}
