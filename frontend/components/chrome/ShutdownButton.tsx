/**
 * ShutdownButton — 우측 상단 종료 버튼 + 단계별 진행 모달.
 *
 * Phase 3.3 추출 (refactor doc 2026-04-30 §R1) — 옛 AppHeader.tsx 의
 * ShutdownBtn / ShutdownOverlay / shutdownModalButton 3 함수 분리 (~310줄).
 *
 * Launcher v2 Hidden 모드 전용 — ENABLE_LOCAL_SHUTDOWN=false 면 자체 null.
 */

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import { ENABLE_LOCAL_SHUTDOWN } from "@/lib/api/client";
import { shutdownStudio } from "@/lib/api/process";
import { toast } from "@/stores/useToastStore";

type ShutdownPhase = "idle" | "confirm" | "running" | "failed";

// 2026-04-30: "전용 창 닫기" row 제거 (작동 불안정 + 시작 모달과 디자인 통일).
// 라벨도 "ComfyUI 종료" → "ComfyUI" 로 단순화 (시작 모달 패턴과 일관).
const SHUTDOWN_STEPS = [
  "ComfyUI",
  "Ollama",
  "Frontend",
  "Backend",
];

export default function ShutdownButton() {
  const [phase, setPhase] = useState<ShutdownPhase>("idle");
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // 2026-04-30: Portal SSR-safe 마운트 가드 — 클라 마운트 후 createPortal 활성화.
  // (SSR/hydration 안전 패턴 — useState lazy init 은 SSR 결과와 hydration mismatch
  //  유발하므로 effect 패턴이 표준.)
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portal SSR-safe 표준 패턴
    setMounted(true);
  }, []);

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
      {/* 2026-04-30: createPortal 로 document.body 직접 마운트 → 부모 트리의
          transform/filter/contain 등 컨테이닝 블록 영향 무관하게 viewport 기준
          정확한 가운데 정렬 보장. */}
      {mounted &&
        modalOpen &&
        createPortal(
          <ShutdownOverlay
            phase={phase}
            activeStep={activeStep}
            error={error}
            onCancel={() => setPhase("idle")}
            onConfirm={confirmShutdown}
          />,
          document.body,
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
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        // 2026-04-30: grid placeItems → flex 로 변경 (더 robust 한 가운데 정렬).
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(31,31,31,.28)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
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
        {canCloseWindow ? (
          // 2026-04-30: 모든 종료 단계 OK → 모달 단순화 (큰 완료 메시지만).
          // 옛 화면은 row 들 / progress bar / kicker / 풋터 모두 표시 → 사용자
          // 시야가 분산. 완료 시점에는 "닫아주세요" 가 유일한 next action.
          <div
            style={{
              display: "grid",
              placeItems: "center",
              gap: 14,
              padding: "24px 0 18px",
              textAlign: "center",
            }}
          >
            <div
              aria-hidden
              style={{
                fontSize: 56,
                lineHeight: 1,
                color: "var(--green-ink)",
              }}
            >
              ✓
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 32,
                lineHeight: 1.2,
                letterSpacing: 0,
              }}
            >
              종료되었습니다
            </h1>
            <p
              style={{
                margin: 0,
                color: "var(--ink-3)",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              모든 서비스가 안전하게 정리됐어요.
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                color: "var(--ink-2)",
              }}
            >
              브라우저 창을 닫아주세요.
            </p>
          </div>
        ) : (
          <>
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
              {running
                ? "AI Image Studio 종료 중"
                : "AI Image Studio를 종료하시겠어요?"}
            </h1>
            {failed && (
              <p
                style={{
                  margin: 0,
                  color: "var(--ink-3)",
                  fontSize: 13,
                  lineHeight: 1.65,
                }}
              >
                {`종료 요청 실패: ${error ?? "unknown"}`}
              </p>
            )}
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
                  background: failed
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
                // 2026-04-30: 상태 라벨 영어 (시작 모달의 OK/RUN/WAIT 와 동일 패턴).
                const stateLabel = done ? "OK" : current ? "RUN" : "WAIT";
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
                    <span
                      className="mono"
                      style={{
                        fontFamily: "Consolas, SFMono-Regular, monospace",
                        letterSpacing: ".04em",
                      }}
                    >
                      {stateLabel}
                    </span>
                  </div>
                );
              })}
            </div>

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
          </>
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
