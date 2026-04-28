"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { STUDIO_BASE } from "@/lib/api/client";
import { fetchProcessStatus, shutdownStudio } from "@/lib/api/process";

type ReadyState = {
  backend: boolean;
  frontend: boolean;
  ollama: boolean;
  comfyui: boolean;
};

const initialReady: ReadyState = {
  backend: false,
  frontend: true,
  ollama: false,
  comfyui: false,
};

export default function LoadingPage() {
  const router = useRouter();
  const [ready, setReady] = useState<ReadyState>(initialReady);
  const [message, setMessage] = useState("서비스 상태 확인 중");
  const [shuttingDown, setShuttingDown] = useState(false);

  const readyCount = useMemo(
    () => Object.values(ready).filter(Boolean).length,
    [ready],
  );
  const progress = Math.round((readyCount / 4) * 100);

  useEffect(() => {
    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      let backendOk = false;
      try {
        const health = await fetch(`${STUDIO_BASE}/api/health`, {
          cache: "no-store",
        });
        backendOk = health.ok;
      } catch {
        backendOk = false;
      }

      const status = await fetchProcessStatus();
      const nextReady = {
        frontend: true,
        backend: backendOk,
        ollama: !!status?.ollamaRunning,
        comfyui: !!status?.comfyuiRunning,
      };

      if (cancelled) return;
      setReady(nextReady);

      const nextCount = Object.values(nextReady).filter(Boolean).length;
      if (nextCount === 4) {
        setMessage("준비 완료");
        redirectTimer = setTimeout(() => router.replace("/"), 800);
      } else if (!nextReady.backend) {
        setMessage("Backend 연결 대기 중");
      } else if (!nextReady.comfyui) {
        setMessage("ComfyUI 준비 중");
      } else if (!nextReady.ollama) {
        setMessage("Ollama 준비 중");
      } else {
        setMessage("서비스 상태 확인 중");
      }
    }

    tick();
    const interval = setInterval(tick, 1200);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [router]);

  async function handleShutdown() {
    if (shuttingDown) return;
    setShuttingDown(true);
    setMessage("종료 요청 전송 중");
    const result = await shutdownStudio();
    setMessage(result.ok ? "종료 중" : `종료 요청 실패: ${result.message ?? "unknown"}`);
    setShuttingDown(false);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background:
          "linear-gradient(180deg, rgba(65,149,245,.08), transparent 42%), var(--bg)",
        color: "var(--ink)",
      }}
    >
      <section
        aria-live="polite"
        style={{
          width: "min(460px, 100%)",
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
          AI Image Studio 시작 중
        </h1>
        <p
          style={{
            margin: 0,
            color: "var(--ink-3)",
            fontSize: 13,
            lineHeight: 1.65,
          }}
        >
          {message}
        </p>

        <div
          style={{
            margin: "24px 0 14px",
            height: 10,
            overflow: "hidden",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--line)",
            background: "var(--bg-2)",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              borderRadius: "inherit",
              background:
                "linear-gradient(90deg, var(--accent), var(--green))",
              transition: "width .25s ease",
            }}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 20,
          }}
        >
          <Status label="Frontend" ok={ready.frontend} />
          <Status label="Backend" ok={ready.backend} />
          <Status label="ComfyUI" ok={ready.comfyui} />
          <Status label="Ollama" ok={ready.ollama} />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => router.replace("/")}
            disabled={!ready.backend}
            style={buttonStyle("neutral", !ready.backend)}
          >
            메인으로
          </button>
          <button
            type="button"
            onClick={handleShutdown}
            disabled={shuttingDown}
            style={buttonStyle("danger", shuttingDown)}
          >
            종료
          </button>
        </div>
      </section>
    </main>
  );
}

function Status({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        minHeight: 34,
        padding: "0 10px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: ok ? "rgba(16,185,129,.08)" : "var(--bg-2)",
        color: ok ? "var(--green)" : "var(--ink-3)",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span>{label}</span>
      <span>{ok ? "OK" : "WAIT"}</span>
    </div>
  );
}

function buttonStyle(kind: "neutral" | "danger", disabled: boolean) {
  return {
    height: 34,
    padding: "0 14px",
    borderRadius: "var(--radius-sm)",
    border:
      kind === "danger"
        ? "1px solid rgba(239,68,68,.32)"
        : "1px solid var(--line)",
    background:
      kind === "danger" ? "rgba(239,68,68,.08)" : "var(--surface)",
    color: kind === "danger" ? "#b42318" : "var(--ink-2)",
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  } as const;
}
