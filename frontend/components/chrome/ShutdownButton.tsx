/**
 * ShutdownButton — 우측 상단 종료 버튼 + 단계별 진행 모달.
 *
 * Phase 3.3 추출 (refactor doc 2026-04-30 §R1) — 옛 AppHeader.tsx 의
 * ShutdownBtn / ShutdownOverlay / shutdownModalButton 3 함수 분리 (~310줄).
 *
 * Launcher v2 Hidden 모드 전용 — ENABLE_LOCAL_SHUTDOWN=false 면 자체 null.
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { ENABLE_LOCAL_SHUTDOWN } from "@/lib/api/client";
import { shutdownStudio } from "@/lib/api/process";
import { toast } from "@/stores/useToastStore";

type ShutdownPhase = "idle" | "confirm" | "running" | "failed";

const SHUTDOWN_STEPS = [
  "ComfyUI 종료",
  "Ollama 종료",
  "Frontend 종료",
  "Backend 종료",
  "전용 창 닫기",
];

export default function ShutdownButton() {
  const [phase, setPhase] = useState<ShutdownPhase>("idle");
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!ENABLE_LOCAL_SHUTDOWN) return null;

  async function confirmShutdown() {
    if (phase === "running") return;

    setError(null);
    setActiveStep(0);
    setPhase("running");

    const timers = SHUTDOWN_STEPS.map((_, index) =>
      window.setTimeout(() => setActiveStep(index + 1), 650 + index * 700),
    );
    const result = await shutdownStudio();
    if (!result.ok) {
      timers.forEach(window.clearTimeout);
      const msg = result.message ?? "stop_v2.ps1을 직접 실행해줘.";
      setError(msg);
      setPhase("failed");
      toast.error("종료 실패", msg);
    }
  }

  const modalOpen = phase !== "idle";
  const running = phase === "running";

  return (
    <>
      {modalOpen && (
        <ShutdownOverlay
          phase={phase}
          activeStep={activeStep}
          error={error}
          onCancel={() => setPhase("idle")}
          onConfirm={confirmShutdown}
        />
      )}
      <button
        type="button"
        onClick={() => setPhase("confirm")}
        disabled={running}
        title="AI Image Studio 종료"
        aria-label="AI Image Studio 종료"
        style={{
          all: "unset",
          cursor: running ? "not-allowed" : "pointer",
          width: 32,
          height: 32,
          borderRadius: "var(--radius-sm)",
          border: "1px solid rgba(239,68,68,.32)",
          background: "rgba(239,68,68,.07)",
          color: "#b42318",
          display: "grid",
          placeItems: "center",
          opacity: running ? 0.55 : 1,
          transition: "all .15s",
        }}
      >
        <Icon name="x" size={15} />
      </button>
    </>
  );
}

function ShutdownOverlay({
  phase,
  activeStep,
  error,
  onCancel,
  onConfirm,
}: {
  phase: ShutdownPhase;
  activeStep: number;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const running = phase === "running";
  const failed = phase === "failed";
  const completed = running ? Math.min(activeStep, SHUTDOWN_STEPS.length) : 0;
  const progress = failed
    ? 100
    : running
      ? Math.round((completed / SHUTDOWN_STEPS.length) * 100)
      : 0;
  const canCloseWindow = running && completed >= SHUTDOWN_STEPS.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(31,31,31,.28)",
        backdropFilter: "blur(8px)",
      }}
    >
      <section
        style={{
          width: "min(500px, 100%)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          background: "var(--surface)",
          padding: 28,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          style={{
            marginBottom: 10,
            color: "var(--ink-4)",
            fontFamily: "Consolas, SFMono-Regular, monospace",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".16em",
          }}
        >
          SHUTDOWN · {String(Math.max(0, completed)).padStart(2, "0")} /{" "}
          {String(SHUTDOWN_STEPS.length).padStart(2, "0")}
        </div>
        <h1
          style={{
            margin: "0 0 8px",
            fontSize: 27,
            lineHeight: 1.2,
            letterSpacing: 0,
          }}
        >
          {running ? "AI Image Studio 종료 중" : "AI Image Studio를 종료할까?"}
        </h1>
        <p
          style={{
            margin: 0,
            color: "var(--ink-3)",
            fontSize: 13,
            lineHeight: 1.65,
          }}
        >
          {failed
            ? `종료 요청 실패: ${error ?? "unknown"}`
            : running
              ? "서비스를 차례로 안전하게 정리하고 있어요."
              : "진행 중인 작업이 있으면 중단돼요. 종료하면 전용 창도 마지막에 닫혀요."}
        </p>
        <div
          style={{
            marginTop: 22,
            height: 7,
            overflow: "hidden",
            borderRadius: "var(--radius-full)",
            background: "var(--bg-2)",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              borderRadius: "inherit",
              background:
                failed
                  ? "rgba(239,68,68,.72)"
                  : "linear-gradient(90deg, var(--accent), rgba(239,68,68,.72))",
              transition: "width .35s ease",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 10,
            color: "var(--ink-3)",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          <span>
            {running
              ? `${SHUTDOWN_STEPS.length}단계 중 ${completed}단계 완료`
              : failed
                ? "종료 실패"
                : "종료 준비"}
          </span>
          <span>{progress}%</span>
        </div>

        <div
          style={{
            display: "grid",
            gap: 8,
            marginTop: 18,
          }}
        >
          {SHUTDOWN_STEPS.map((label, index) => {
            const done = running && activeStep > index;
            const current = running && activeStep === index;
            const isFinalStep = index === SHUTDOWN_STEPS.length - 1;
            return (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: 32,
                  padding: "0 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--line)",
                  background: done
                    ? "rgba(16,185,129,.08)"
                    : current
                      ? "rgba(31,31,31,.06)"
                      : "var(--surface)",
                  color: done
                    ? "var(--green-ink)"
                    : current
                      ? "var(--ink)"
                      : "var(--ink-4)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span>{label}</span>
                {isFinalStep && canCloseWindow ? (
                  <button
                    type="button"
                    onClick={() => window.close()}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      height: 24,
                      padding: "0 9px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(46,125,50,.28)",
                      background: "rgba(46,125,50,.08)",
                      color: "var(--green-ink)",
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    닫기
                  </button>
                ) : (
                  <span>{done ? "완료" : current ? "종료 중" : "대기"}</span>
                )}
              </div>
            );
          })}
        </div>

        {canCloseWindow && (
          <p
            style={{
              margin: "14px 0 0",
              color: "var(--ink-4)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            닫기 버튼이 반응하지 않으면 브라우저 창의 X로 닫아도 돼요.
          </p>
        )}

        {!running && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 22,
            }}
          >
            <button
              type="button"
              onClick={onCancel}
              style={shutdownModalButton("neutral")}
            >
              취소
            </button>
            <button
              type="button"
              onClick={onConfirm}
              style={shutdownModalButton("danger")}
            >
              종료
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function shutdownModalButton(kind: "neutral" | "danger") {
  return {
    height: 34,
    padding: "0 14px",
    borderRadius: "var(--radius-sm)",
    border:
      kind === "danger"
        ? "1px solid rgba(239,68,68,.34)"
        : "1px solid var(--line)",
    background:
      kind === "danger" ? "rgba(239,68,68,.08)" : "var(--surface)",
    color: kind === "danger" ? "#b42318" : "var(--ink-2)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
  } as const;
}
