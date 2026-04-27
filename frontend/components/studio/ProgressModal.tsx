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
import { interruptCurrent } from "@/lib/api/process";
import type { HistoryMode } from "@/lib/api/types";
import { toast } from "@/stores/useToastStore";
import { useEditStore } from "@/stores/useEditStore";
import { useGenerateStore } from "@/stores/useGenerateStore";
import { useVideoStore } from "@/stores/useVideoStore";
// 2026-04-27 (C2-P1-2): 3 mode 타임라인 + TimelineRow + DetailBox 분해.
// 2026-04-27 (Phase 2): Edit 는 PipelineTimeline 으로 교체. Generate/Video 는 Phase 3 에서 통일.
import { PipelineTimeline } from "./progress/PipelineTimeline";
import {
  GenerateTimeline,
  VideoTimeline,
} from "./progress/Timelines";

export default function ProgressModal({
  mode,
  onClose,
}: {
  mode: HistoryMode;
  onClose: () => void;
}) {
  const canInterruptComfy = useComfyInterruptAvailability(mode);
  const headerTitle =
    mode === "generate"
      ? "이미지 생성 중"
      : mode === "edit"
        ? "이미지 수정 중"
        : "영상 생성 중";
  const handleCancel = async () => {
    if (!canInterruptComfy) return;
    const ok = await interruptCurrent();
    if (ok) {
      toast.warn("ComfyUI 인터럽트 전송", "현재 샘플링 중단 시도됨");
    } else {
      toast.error("인터럽트 실패", "백엔드 상태 확인");
    }
  };

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
          borderRadius: "var(--radius-lg)",
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
          title={headerTitle}
          onClose={onClose}
          onCancel={handleCancel}
          canInterruptComfy={canInterruptComfy}
        />
        <StatusBar mode={mode} />
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 22px 22px",
          }}
        >
          {mode === "generate" ? (
            <GenerateTimeline />
          ) : mode === "edit" ? (
            <PipelineTimeline mode="edit" />
          ) : (
            <VideoTimeline />
          )}
        </div>
      </section>
    </div>
  );
}

function useComfyInterruptAvailability(mode: HistoryMode): boolean {
  const genRunning = useGenerateStore((s) => s.generating);
  const genStageHistory = useGenerateStore((s) => s.stageHistory);

  const editRunning = useEditStore((s) => s.running);
  // Phase 2 (2026-04-27): currentStep===4 → lastStage==="comfyui-sampling" 판정.
  const editStageHistory = useEditStore((s) => s.stageHistory);

  const videoRunning = useVideoStore((s) => s.running);
  const videoCurrentStep = useVideoStore((s) => s.currentStep);

  const lastGenStage = genStageHistory[genStageHistory.length - 1]?.type;
  const lastEditStage = editStageHistory[editStageHistory.length - 1]?.type;

  if (mode === "generate") {
    return genRunning && lastGenStage === "comfyui-sampling";
  }
  if (mode === "edit") {
    return editRunning && lastEditStage === "comfyui-sampling";
  }
  if (mode === "video") {
    return videoRunning && videoCurrentStep === 4;
  }
  return false;
}

/**
 * StatusBar - 헤더 바로 아래에 표시되는 "상태 스트립".
 * 경과 시간 (mm:ss) + ComfyUI 샘플링 스텝 (3/40) + 전체 진행률 %.
 *
 * 500ms 간격으로 tick — 경과 시간 즉시성 유지.
 */
function StatusBar({ mode }: { mode: HistoryMode }) {
  // mode 별 store 에서 startedAt / sampling 정보 pull
  const genStartedAt = useGenerateStore((s) => s.startedAt);
  const genSamplingStep = useGenerateStore((s) => s.samplingStep);
  const genSamplingTotal = useGenerateStore((s) => s.samplingTotal);
  const genProgress = useGenerateStore((s) => s.progress);
  const genRunning = useGenerateStore((s) => s.generating);

  const editStartedAt = useEditStore((s) => s.startedAt);
  const editSamplingStep = useEditStore((s) => s.samplingStep);
  const editSamplingTotal = useEditStore((s) => s.samplingTotal);
  const editRunning = useEditStore((s) => s.running);
  // audit P1a: Edit 진행률 기준을 본문 bar 와 동일한 pipelineProgress 로 통일.
  // 기존 stepDone/4 기반은 Step4(ComfyUI 샘플링) 내부 세부 진행을 반영 못 해서
  // 상단 % 가 75% 에 정체되는데 본문 bar 는 계속 움직이는 불일치가 있었음.
  const editProgress = useEditStore((s) => s.pipelineProgress);

  const videoStartedAt = useVideoStore((s) => s.startedAt);
  const videoSamplingStep = useVideoStore((s) => s.samplingStep);
  const videoSamplingTotal = useVideoStore((s) => s.samplingTotal);
  const videoRunning = useVideoStore((s) => s.running);
  const videoProgress = useVideoStore((s) => s.pipelineProgress);

  const startedAt =
    mode === "generate"
      ? genStartedAt
      : mode === "edit"
        ? editStartedAt
        : videoStartedAt;
  const samplingStep =
    mode === "generate"
      ? genSamplingStep
      : mode === "edit"
        ? editSamplingStep
        : videoSamplingStep;
  const samplingTotal =
    mode === "generate"
      ? genSamplingTotal
      : mode === "edit"
        ? editSamplingTotal
        : videoSamplingTotal;
  const running =
    mode === "generate"
      ? genRunning
      : mode === "edit"
        ? editRunning
        : videoRunning;
  // Generate/Edit/Video 모두 백엔드 stream 기반 progress (0~100) 사용.
  // Edit 는 audit P1a 에서 stepDone/4 → pipelineProgress 로 통일.
  const progress =
    mode === "generate"
      ? genProgress
      : mode === "edit"
        ? editProgress
        : videoProgress;

  // 경과 시간 500ms tick
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !startedAt) return;
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const elapsedSec = startedAt
    ? Math.max(0, Math.floor((nowTick - startedAt) / 1000))
    : 0;
  const mm = Math.floor(elapsedSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (elapsedSec % 60).toString().padStart(2, "0");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "10px 22px",
        background: "var(--bg-2)",
        borderBottom: "1px solid var(--line)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StatusChip
          icon="clock"
          label={`${mm}:${ss}`}
          title="총 경과 시간"
          mono
        />
        {samplingStep != null && samplingTotal != null && samplingTotal > 0 && (
          <StatusChip
            icon="cpu"
            label={`스텝 ${samplingStep}/${samplingTotal}`}
            title="ComfyUI 샘플러 진행 스텝"
            mono
          />
        )}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--accent)",
          letterSpacing: ".04em",
        }}
      >
        {progress}%
      </div>
    </div>
  );
}

function StatusChip({
  icon,
  label,
  title,
  mono = false,
}: {
  icon: "clock" | "cpu";
  label: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div
      title={title}
      className={mono ? "mono" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: "var(--ink-2)",
      }}
    >
      <Icon name={icon} size={12} />
      <span style={{ fontSize: 11.5 }}>{label}</span>
    </div>
  );
}

/* ── 공통 헤더 ── */
function Header({
  title,
  onClose,
  onCancel,
  canInterruptComfy,
}: {
  title: string;
  onClose: () => void;
  onCancel: () => void;
  canInterruptComfy: boolean;
}) {
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
            letterSpacing: 0,
          }}
        >
          {title}
        </h2>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {canInterruptComfy && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 500,
              padding: "5px 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(192,57,43,.32)",
              background: "#FCEDEC",
              color: "#C0392B",
            }}
            // UI P0-6: 실제 /interrupt 가 먹히는 ComfyUI 단계에서만 노출.
            title="ComfyUI 샘플링 중단"
            aria-label="ComfyUI 샘플링 중단"
          >
            ComfyUI 중단
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            all: "unset",
            cursor: "pointer",
            width: 28,
            height: 28,
            borderRadius: "var(--radius-sm)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
          }}
          title="모달 닫기 (생성은 계속됨)"
          aria-label="닫기"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </header>
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
