/**
 * AppHeader — 모든 페이지 공용 통합 헤더.
 *
 * 라우트 자동 분기 (usePathname):
 *   "/"               → 메인. HomeBtn 숨김 (이미 메인이니까).
 *   "/generate" 등    → 메뉴 페이지. HomeBtn 표시.
 *
 * 우측 영역 순서 (오빠 결정 7):
 *   [SystemStatusChip][SystemMetrics][SettingsButton]
 *
 * 2026-04-26 신설 — 6 페이지가 동일한 TopBar 패턴 5번 반복하던 걸 한 줄로 통합.
 *   각 페이지는 <AppHeader /> 한 줄만 호출.
 */

"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Logo, TopBar } from "./Chrome";
import SettingsButton from "@/components/settings/SettingsButton";
import SystemMetrics from "./SystemMetrics";
import SystemStatusChip from "./SystemStatusChip";
import Icon from "@/components/ui/Icon";
import { ENABLE_LOCAL_SHUTDOWN, USE_MOCK } from "@/lib/api/client";
import { shutdownStudio } from "@/lib/api/process";
import { toast } from "@/stores/useToastStore";

/** 홈 아이콘 버튼 — 메뉴 페이지 좌측 상단 (BackBtn 자리 대체).
 *  icon-only · tooltip "메인으로" · 단축키 없음 (Esc 충돌 회피).
 */
function HomeBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="메인으로"
      aria-label="메인으로"
      style={{
        all: "unset",
        cursor: "pointer",
        width: 32,
        height: 32,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        color: "var(--ink-2)",
        display: "grid",
        placeItems: "center",
        transition: "all .15s",
      }}
      onMouseEnter={(e) => {
        const t = e.currentTarget as HTMLButtonElement;
        t.style.borderColor = "var(--line-2)";
        t.style.background = "var(--bg-2)";
        t.style.color = "var(--ink)";
      }}
      onMouseLeave={(e) => {
        const t = e.currentTarget as HTMLButtonElement;
        t.style.borderColor = "var(--line)";
        t.style.background = "var(--surface)";
        t.style.color = "var(--ink-2)";
      }}
    >
      <Icon name="home" size={15} />
    </button>
  );
}

function MockModeBadge() {
  if (!USE_MOCK) return null;

  return (
    <div
      role="status"
      title="NEXT_PUBLIC_USE_MOCK=true"
      style={{
        display: "flex",
        alignItems: "center",
        height: 26,
        padding: "0 9px",
        borderRadius: "var(--radius-full)",
        border: "1px solid rgba(245,158,11,.42)",
        background: "rgba(245,158,11,.10)",
        color: "var(--amber-ink)",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: ".06em",
        whiteSpace: "nowrap",
      }}
    >
      MOCK
    </div>
  );
}

type ShutdownPhase = "idle" | "confirm" | "running" | "failed";

const SHUTDOWN_STEPS = [
  "ComfyUI 종료",
  "Ollama 종료",
  "Frontend 종료",
  "Backend 종료",
  "브라우저 창 닫기",
];

function ShutdownBtn() {
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
        background: "rgba(250,249,247,.92)",
        backdropFilter: "blur(8px)",
      }}
    >
      <section
        style={{
          width: "min(420px, 100%)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          background: "var(--surface)",
          padding: 28,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <h1
          style={{
            margin: "0 0 8px",
            fontSize: 24,
            lineHeight: 1.25,
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
              ? "켜져 있던 서비스들을 순서대로 정리하고 있어."
              : "진행 중인 작업이 있으면 중단돼. 종료하면 이 전용 브라우저 창도 마지막에 닫혀."}
        </p>
        <div
          style={{
            marginTop: 24,
            height: 10,
            overflow: "hidden",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--line)",
            background: "var(--bg-2)",
          }}
        >
          <div
            style={{
              width: running
                ? `${Math.min(100, Math.round((activeStep / SHUTDOWN_STEPS.length) * 100))}%`
                : failed
                  ? "100%"
                  : "0%",
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
            display: "grid",
            gap: 8,
            marginTop: 18,
          }}
        >
          {SHUTDOWN_STEPS.map((label, index) => {
            const done = running && activeStep > index;
            const current = running && activeStep === index;
            return (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: 32,
                  padding: "0 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--line)",
                  background: done ? "rgba(16,185,129,.08)" : "var(--bg-2)",
                  color: done ? "var(--green-ink)" : "var(--ink-3)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span>{label}</span>
                <span>{done ? "완료" : current ? "진행 중" : "대기"}</span>
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

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();

  // 메인 페이지는 HomeBtn 숨김
  const showHomeBtn = pathname !== "/";

  return (
    <TopBar
      left={
        showHomeBtn ? (
          <>
            <HomeBtn onClick={() => router.push("/")} />
            <Logo />
          </>
        ) : (
          <Logo />
        )
      }
      right={
        <>
          <MockModeBadge />
          <SystemStatusChip />
          <SystemMetrics />
          <SettingsButton />
          <ShutdownBtn />
        </>
      }
    />
  );
}
