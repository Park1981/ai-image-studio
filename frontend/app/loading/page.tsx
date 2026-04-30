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

// 2026-04-30: ComfyUI 를 마지막으로 이동 (실제 가장 오래 걸리는 부팅 + 2-col grid 의 오른쪽 아래 슬롯).
// 부팅 순서: Frontend → Backend → Ollama → ComfyUI (가장 무거운 거 마지막).
const BOOT_STEPS: Array<keyof ReadyState> = [
  "frontend",
  "backend",
  "ollama",
  "comfyui",
];

/** 터미널 로그 표시 여부 — localStorage 에 사용자 선택 기억. */
const TERMINAL_VISIBLE_KEY = "loading.terminalVisible";

/** 부팅이 비정상적으로 오래 걸리는 임계 (ms).
 *  - 정상 부팅: 보통 30~60초
 *  - 백엔드 _STARTUP_TIMEOUT (process_manager.py): 120초 (2분) — 이때 프로세스 강제 종료
 *  - 우리 경고 임계: 180초 (3분) — 백엔드 timeout 직후 status 가 영원히 not running 으로
 *    유지되는 시나리오에서 사용자가 종료 후 재시도 결정할 수 있게 알림 표시. */
const STARTUP_WARN_MS = 180_000;

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
  // 2026-04-30: 터미널 로그 토글 — 기본 표시, localStorage 로 사용자 선택 기억.
  const [showTerminal, setShowTerminal] = useState(true);

  // 마운트 시 localStorage 에서 마지막 토글 상태 복원.
  // SSR / hydration 안전: 초기 state 는 기본값 true → 클라 마운트 후 effect 에서 다른 값이면 update.
  // (lazy init 으로 처리하면 Next.js 의 SSR 결과 와 hydration 결과 mismatch 위험 → effect 패턴이 안전.)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TERMINAL_VISIBLE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage 동기화는 effect 외엔 SSR-safe 하게 못 함
      if (saved !== null) setShowTerminal(saved === "1");
    } catch {
      // localStorage 비활성/시크릿 모드 — 기본값 유지
    }
  }, []);

  // 토글 변경 시 localStorage 에 저장.
  function toggleTerminal() {
    setShowTerminal((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(TERMINAL_VISIBLE_KEY, next ? "1" : "0");
      } catch {
        // 저장 실패 무시 (UX 영향 없음)
      }
      return next;
    });
  }

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
      } else if (!nextReady.ollama) {
        setMessage("Ollama 준비 중");
      } else if (!nextReady.comfyui) {
        setMessage("ComfyUI 준비 중");
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <h1 style={titleStyle}>AI Image Studio 시작 중</h1>
          <button
            type="button"
            onClick={toggleTerminal}
            aria-pressed={showTerminal}
            aria-label={showTerminal ? "터미널 로그 숨기기" : "터미널 로그 보이기"}
            style={terminalToggleStyle(showTerminal)}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                marginRight: 6,
                transition: "transform .15s ease",
                transform: showTerminal ? "rotate(180deg)" : "rotate(0deg)",
              }}
            >
              ▾
            </span>
            Terminal Log
          </button>
        </div>
        {/* 2026-04-30: "부팅 로그를 보여드릴게요..." 설명 문구 제거 — 군더더기. */}

        {showTerminal && (
          <Terminal
            ready={ready}
            activeKey={activeKey}
            elapsedMs={elapsedMs}
            message={message}
          />
        )}

        {elapsedMs > STARTUP_WARN_MS && readyCount < BOOT_STEPS.length && (
          <StartupWarning activeLabel={LABELS[activeKey]} />
        )}

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

        {/* 2026-04-30: 2x2 grid → 1열 stacked (종료 모달과 디자인 통일).
            한 줄에 라벨 / 포트 / 상태 인라인 정렬. */}
        <div
          style={{
            display: "grid",
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

        {/* 2026-04-30: "메인으로" 버튼 제거 — 모든 ready 시 자동 redirect 되므로 의미 없음. */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
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

/** 3분 이상 걸리는 비정상 부팅 시 표시되는 경고 배너.
 *  백엔드 _STARTUP_TIMEOUT (120s) 후 프로세스가 강제 종료된 시나리오 가정 —
 *  사용자가 logs 확인 + 종료 후 재시작을 결정할 수 있게 안내. */
function StartupWarning({ activeLabel }: { activeLabel: string }) {
  return (
    <div
      role="alert"
      style={{
        marginTop: 16,
        padding: "12px 14px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid rgba(217,119,6,.32)",
        background: "rgba(217,119,6,.08)",
        color: "var(--ink-2)",
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
          color: "#b45309",
          fontWeight: 800,
          fontSize: 12,
          letterSpacing: ".02em",
        }}
      >
        <span>⚠ 시작이 너무 오래 걸려요</span>
      </div>
      <div style={{ color: "var(--ink-3)" }}>
        <b>{activeLabel}</b> 가 3분 넘게 응답하지 않아요. 보통 30~60초면 끝나요.
        <br />
        <code style={codeChipStyle}>logs/comfyui.log</code> ·{" "}
        <code style={codeChipStyle}>logs/backend.log</code> 확인 후{" "}
        <b>아래 종료 버튼</b> 으로 재시작을 권장해요.
      </div>
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

/** 2026-04-30: 종료 모달 row 패턴과 동일 — 한 줄 안에 라벨 / 포트 / 상태 inline.
 *  옛 2-line (라벨/상태 위에 포트 아래) → 1-line (서비스명  포트  상태) 로 단순화. */
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
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        minHeight: 32,
        padding: "0 12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: ok
          ? "rgba(16,185,129,.08)"
          : current
            ? "rgba(74,158,255,.08)"
            : "var(--surface)",
        color: ok ? "var(--green-ink)" : current ? "var(--accent-ink)" : "var(--ink-4)",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span>{label}</span>
      <span
        className="mono"
        style={{
          flex: 1,
          marginLeft: 12,
          color: "var(--ink-4)",
          fontFamily: "Consolas, SFMono-Regular, monospace",
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: ".02em",
        }}
      >
        {detail}
      </span>
      <span
        className="mono"
        style={{
          fontFamily: "Consolas, SFMono-Regular, monospace",
          letterSpacing: ".04em",
          fontWeight: 800,
        }}
      >
        {ok ? "OK" : current ? "RUN" : "WAIT"}
      </span>
    </div>
  );
}

/** 터미널 로그 토글 버튼 스타일 — 페이지 톤 (인라인) 일관 유지. */
function terminalToggleStyle(active: boolean): CSSProperties {
  return {
    height: 26,
    padding: "0 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--line)",
    background: active ? "var(--bg-2)" : "var(--surface)",
    color: active ? "var(--ink-2)" : "var(--ink-3)",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: ".02em",
    cursor: "pointer",
    flexShrink: 0,
    fontFamily: "Consolas, SFMono-Regular, monospace",
  };
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

const codeChipStyle: CSSProperties = {
  padding: "1px 6px",
  borderRadius: 4,
  border: "1px solid var(--line)",
  background: "var(--bg-2)",
  fontFamily: "Consolas, SFMono-Regular, monospace",
  fontSize: 11.5,
  color: "var(--ink-2)",
};

const cursorStyle: CSSProperties = {
  display: "inline-block",
  width: 7,
  height: 14,
  marginLeft: 5,
  background: "#f1eee7",
  verticalAlign: -2,
};
