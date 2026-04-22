/**
 * ProgressModal - 생성/수정 진행 과정 라이브 모달.
 *
 * 유저 피드백 #1 에 대응: "% 만 나오니 심심. AI 생각 등 보여달라."
 *
 * 보이는 내용:
 *  - 각 파이프라인 단계의 현재 상태 (대기 / 진행중 / 완료 / 에러)
 *  - 단계별 소요 시간
 *  - Edit 모드: step 1 완료 시 비전 설명, step 2 완료 시 최종 프롬프트
 *  - Generate 모드: stage 타임라인
 *  - 닫기 버튼 — 생성 취소 아님, 모달만 닫음 (백그라운드 진행 유지)
 *
 * 둘 다 하나의 컴포넌트에서 `mode` prop 으로 분기.
 */

"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";
import {
  useGenerateStore,
  type StageEvent,
} from "@/stores/useGenerateStore";
import { useEditStore } from "@/stores/useEditStore";

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

export default function ProgressModal({
  mode,
  onClose,
}: {
  mode: "generate" | "edit";
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="진행 상황"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(23, 20, 14, 0.42)",
        display: "grid",
        placeItems: "center",
        animation: "fade-in .18s ease",
        padding: 20,
      }}
    >
      <section
        style={{
          background: "var(--bg)",
          borderRadius: 16,
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--line)",
          width: "min(620px, 100%)",
          maxHeight: "85vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "scale-in .22s cubic-bezier(.22,1,.36,1)",
        }}
      >
        <Header
          title={mode === "generate" ? "이미지 생성 중" : "이미지 수정 중"}
          onClose={onClose}
        />
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 22px 22px",
          }}
        >
          {mode === "generate" ? <GenerateTimeline /> : <EditTimeline />}
        </div>
      </section>
    </div>
  );
}

/* ── 공통 헤더 ── */
function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Spinner size={14} color="var(--accent)" />
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          all: "unset",
          cursor: "pointer",
          width: 28,
          height: 28,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
        }}
        title="닫기 (생성은 계속됨)"
        aria-label="닫기"
      >
        <Icon name="x" size={16} />
      </button>
    </header>
  );
}

/* ── Generate 타임라인 ── */
function GenerateTimeline() {
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
function EditTimeline() {
  const running = useEditStore((s) => s.running);
  const stepDone = useEditStore((s) => s.stepDone);
  const currentStep = useEditStore((s) => s.currentStep);
  const stepHistory = useEditStore((s) => s.stepHistory);

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
            {/* step 1 비전 설명 */}
            {m.n === 1 && detail?.description && isDone && (
              <DetailBox kind="info" title="비전 설명">
                {detail.description}
              </DetailBox>
            )}
            {/* step 2 최종 프롬프트 */}
            {m.n === 2 && detail?.finalPrompt && isDone && (
              <DetailBox
                kind={detail.provider === "fallback" ? "warn" : "info"}
                title={`최종 프롬프트 (${detail.provider})`}
              >
                {detail.finalPrompt}
              </DetailBox>
            )}
          </div>
        );
      })}
    </ol>
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
            color:
              state === "pending" ? "var(--ink-4)" : "var(--ink)",
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

/* ── 상세 정보 박스 (비전 설명 · 최종 프롬프트) ── */
function DetailBox({
  kind,
  title,
  children,
}: {
  kind: "info" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  const bg = kind === "warn" ? "var(--amber-soft)" : "var(--bg-2)";
  const border =
    kind === "warn" ? "rgba(250,173,20,.35)" : "var(--line)";
  return (
    <div
      style={{
        marginLeft: 34,
        marginTop: 4,
        padding: "10px 12px",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
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

/* ── 사용 편의 훅: auto-close ── */
export function useAutoCloseOnDone(
  open: boolean,
  running: boolean,
  onClose: () => void,
  delayMs = 1200,
) {
  const [lastClosedAtGen, setLast] = useState(0);
  useEffect(() => {
    if (!open) return;
    if (running) return;
    // running=false 로 전환됐을 때 delay 후 close
    const t = setTimeout(() => {
      setLast(Date.now());
      onClose();
    }, delayMs);
    return () => clearTimeout(t);
  }, [open, running, onClose, delayMs]);
  return lastClosedAtGen;
}

/* ── 애니메이션 keyframes ── */
if (typeof document !== "undefined" && !document.getElementById("pm-kf")) {
  const s = document.createElement("style");
  s.id = "pm-kf";
  s.textContent = `
@keyframes fade-in {from{opacity:0}to{opacity:1}}
@keyframes scale-in {from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
@keyframes pulse {0%,100%{opacity:1}50%{opacity:.4}}
`;
  document.head.appendChild(s);
}
