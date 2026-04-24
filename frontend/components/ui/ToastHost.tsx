/**
 * ToastHost - 우측 하단에서 쌓이는 토스트 알림 렌더러.
 * AppShell 에 한 번 마운트, 전역 useToastStore 구독.
 */

"use client";

import type { CSSProperties } from "react";
import Icon, { type IconName } from "./Icon";
import {
  useToastStore,
  type Toast,
  type ToastKind,
} from "@/stores/useToastStore";

const KIND_THEME: Record<
  ToastKind,
  { icon: IconName; accent: string; bg: string; border: string }
> = {
  info: {
    icon: "dot",
    accent: "var(--ink-2)",
    bg: "var(--surface)",
    border: "var(--line)",
  },
  success: {
    icon: "check",
    accent: "var(--green-ink)",
    bg: "var(--green-soft)",
    border: "rgba(82,196,26,.32)",
  },
  warn: {
    icon: "search",
    accent: "var(--amber-ink)",
    bg: "var(--amber-soft)",
    border: "rgba(250,173,20,.35)",
  },
  error: {
    icon: "x",
    accent: "#C0392B",
    bg: "#FCEDEC",
    border: "rgba(192,57,43,.32)",
  },
};

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const theme = KIND_THEME[toast.kind];
  // audit R1-2: borderRadius 10 → var(--radius) 로 토큰화 (기본 input 과 동일 계열)
  const wrap: CSSProperties = {
    pointerEvents: "auto",
    minWidth: 260,
    maxWidth: 360,
    padding: "12px 14px",
    borderRadius: "var(--radius)",
    background: theme.bg,
    border: `1px solid ${theme.border}`,
    boxShadow: "var(--shadow-md)",
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    animation: "toast-in .22s ease-out",
  };
  return (
    <div style={wrap}>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "var(--radius-full)",
          background: "var(--surface)",
          display: "grid",
          placeItems: "center",
          color: theme.accent,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        <Icon name={theme.icon} size={12} stroke={2.2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: 0,
          }}
        >
          {toast.title}
        </div>
        {toast.desc && (
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              marginTop: 2,
              lineHeight: 1.5,
            }}
          >
            {toast.desc}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          all: "unset",
          cursor: "pointer",
          color: "var(--ink-4)",
          padding: 4,
          marginTop: -2,
          borderRadius: 6,
          flexShrink: 0,
        }}
        aria-label="닫기"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

// 토스트 등장 애니메이션 keyframe 주입 (모듈 최초 로드 시 1회)
if (typeof document !== "undefined" && !document.getElementById("toast-kf")) {
  const s = document.createElement("style");
  s.id = "toast-kf";
  s.textContent =
    "@keyframes toast-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}";
  document.head.appendChild(s);
}
