"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { STUDIO_BASE } from "@/lib/api/client";
import { fetchProcessStatus, shutdownStudio } from "@/lib/api/process";

type ReadyState = {
  frontend: boolean;
  backend: boolean;
  comfyui: boolean;
  ollama: boolean;
};

const initialReady: ReadyState = {
  frontend: true,
  backend: false,
  comfyui: false,
  ollama: false,
};

const BOOT_STEPS: Array<keyof ReadyState> = [
  "frontend",
  "backend",
  "comfyui",
  "ollama",
];

const LABELS: Record<keyof ReadyState, string> = {
  frontend: "Frontend",
  backend: "Backend",
  comfyui: "ComfyUI",
  ollama: "Ollama",
};

const PORTS: Record<keyof ReadyState, string> = {
  frontend: "127.0.0.1:3000",
  backend: "127.0.0.1:8001",
  comfyui: "127.0.0.1:8000",
  ollama: "127.0.0.1:11434",
};

export default function LoadingPage() {
  const router = useRouter();
  const [ready, setReady] = useState<ReadyState>(initialReady);
  const [message, setMessage] = useState("Backend 연결 대기 중");
  const [shuttingDown, setShuttingDown] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  const readyCount = useMemo(
    () => BOOT_STEPS.filter((key) => ready[key]).length,
    [ready],
  );
  const progress = Math.round((readyCount / BOOT_STEPS.length) * 100);
  const activeKey =
    BOOT_STEPS.find((key) => !ready[key]) ?? BOOT_STEPS[BOOT_STEPS.length - 1];

  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsedMs(Date.now() - startedAt),
      250,
    );
    return () => window.clearInterval(timer);
  }, [startedAt]);

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
        comfyui: !!status?.comfyuiRunning,
        ollama: !!status?.ollamaRunning,
      };

      if (cancelled) return;
      setReady(nextReady);

      const nextCount = BOOT_STEPS.filter((key) => nextReady[key]).length;
      if (nextCount === BOOT_STEPS.length) {
        setMessage("준비 완료");
        redirectTimer = setTimeout(() => router.replace("/"), 1800);
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
    setMessage(
      result.ok ? "종료 중" : `종료 요청 실패: ${result.message ?? "unknown"}`,
    );
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
          "repeating-linear-gradient(-45deg, rgba(31,31,31,.035) 0, rgba(31,31,31,.035) 8px, transparent 8px, transparent 18px), var(--bg)",
        color: "var(--ink)",
      }}
    >
      <section
        aria-live="polite"
        style={{
          width: "min(560px, 100%)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-card)",
          background: "var(--surface)",
          padding: 28,
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <Kicker>
          BOOT · {String(Math.max(1, readyCount)).padStart(2, "0")} /{" "}
          {String(BOOT_STEPS.length).padStart(2, "0")}
        </Kicker>
        <h1 style={titleStyle}>AI Image Studio 시작 중</h1>
        <p style={descStyle}>
          부팅 로그를 보여드릴게요. 이상 없으면 곧 메인이 열려요.
        </p>

        <Terminal
          ready={ready}
          activeKey={activeKey}
          elapsedMs={elapsedMs}
          message={message}
        />

        <Progress value={progress} tone="boot" />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 10,
            color: "var(--ink-3)",
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          <span>{message}</span>
          <span>{progress}%</span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginTop: 18,
          }}
        >
          {BOOT_STEPS.map((key) => (
            <Status
              key={key}
              label={LABELS[key]}
              detail={PORTS[key]}
              ok={ready[key]}
              current={key === activeKey && !ready[key]}
            />
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
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

function Terminal({
  ready,
  activeKey,
  elapsedMs,
  message,
}: {
  ready: ReadyState;
  activeKey: keyof ReadyState;
  elapsedMs: number;
  message: string;
}) {
  return (
    <div
      style={{
        marginTop: 22,
        padding: 18,
        minHeight: 154,
        borderRadius: 10,
        background: "#1f1e1b",
        color: "#dedbd2",
        fontFamily: "Consolas, SFMono-Regular, monospace",
        fontSize: 13,
        lineHeight: 1.7,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.05)",
      }}
    >
      <LogLine time="00:00.00" kind="run" text="[boot] Chrome app window mounted" />
      <LogLine time="00:00.18" kind="ok" text="[ok] Frontend ready" />
      <LogLine
        time="00:00.42"
        kind={ready.backend ? "ok" : "run"}
        text={`${ready.backend ? "[ok]" : "[run]"} Backend -> http://127.0.0.1:8001`}
      />
      <LogLine
        time={formatElapsed(elapsedMs)}
        kind={ready[activeKey] ? "ok" : "run"}
        text={`${ready[activeKey] ? "[ok]" : "[run]"} ${message}`}
      />
      <div>
        <span style={{ color: "#8f8b84", marginRight: 8 }}>
          {formatElapsed(elapsedMs)}
        </span>
        $ <span style={cursorStyle} />
      </div>
    </div>
  );
}

function LogLine({
  time,
  kind,
  text,
}: {
  time: string;
  kind: "ok" | "run";
  text: string;
}) {
  return (
    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      <span style={{ color: "#8f8b84", marginRight: 8 }}>{time}</span>
      <span style={{ color: kind === "ok" ? "#9bcf9a" : "#f1eee7", fontWeight: 700 }}>
        {text}
      </span>
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function Progress({ value, tone }: { value: number; tone: "boot" | "shutdown" }) {
  return (
    <div
      style={{
        height: 7,
        marginTop: 18,
        overflow: "hidden",
        borderRadius: "var(--radius-full)",
        background: "var(--bg-2)",
      }}
    >
      <div
        style={{
          width: `${value}%`,
          height: "100%",
          borderRadius: "inherit",
          background:
            tone === "boot"
              ? "linear-gradient(90deg, var(--ink), var(--accent))"
              : "linear-gradient(90deg, var(--accent), rgba(239,68,68,.72))",
          transition: "width .25s ease",
        }}
      />
    </div>
  );
}

function Status({
  label,
  detail,
  ok,
  current,
}: {
  label: string;
  detail: string;
  ok: boolean;
  current: boolean;
}) {
  return (
    <div
      style={{
        minHeight: 46,
        padding: "8px 10px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: ok
          ? "rgba(16,185,129,.08)"
          : current
            ? "rgba(74,158,255,.08)"
            : "var(--bg-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          color: ok ? "var(--green-ink)" : current ? "var(--accent-ink)" : "var(--ink-3)",
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        <span>{label}</span>
        <span>{ok ? "OK" : current ? "RUN" : "WAIT"}</span>
      </div>
      <div
        style={{
          marginTop: 3,
          color: "var(--ink-4)",
          fontFamily: "Consolas, SFMono-Regular, monospace",
          fontSize: 10.5,
        }}
      >
        {detail}
      </div>
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

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `00:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const titleStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: 27,
  lineHeight: 1.2,
  letterSpacing: 0,
};

const descStyle: CSSProperties = {
  margin: 0,
  color: "var(--ink-3)",
  fontSize: 14,
  lineHeight: 1.6,
};

const cursorStyle: CSSProperties = {
  display: "inline-block",
  width: 7,
  height: 14,
  marginLeft: 5,
  background: "#f1eee7",
  verticalAlign: -2,
};
