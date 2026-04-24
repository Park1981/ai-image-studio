/**
 * ResultHoverActionBar — 결과 뷰어(이미지/영상) 하단 호버 액션바.
 * 2026-04-24 · 결과 영역 UX v2.
 *
 * 동작:
 *  - 부모 컨테이너가 hover 감지 → hovered prop 전달
 *  - 페이드 인 (opacity + translateY) with backdrop-blur 글래스
 *  - 좌측 요약(summary) + 우측 버튼 slot
 *  - pointer-events 는 hovered 일 때만 활성 → 뷰어 상호작용 방해 X
 *
 * 사용처: /generate, /edit, /video 결과 뷰어 공용.
 * 액션바 버튼은 ActionBarButton 서브컴포넌트 권장 (스타일 통일).
 */

"use client";

import { useState, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

interface Props {
  /** 부모 컨테이너의 호버 상태. 부모가 onMouseEnter/Leave 로 관리. */
  hovered: boolean;
  /** 좌측 요약 영역 (예: 프롬프트 한 줄 ellipsis + 사이즈). 없으면 버튼만 우측 정렬. */
  summary?: ReactNode;
  /** 우측 버튼 slot. ActionBarButton 권장. */
  children: ReactNode;
}

export default function ResultHoverActionBar({ hovered, summary, children }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "12px 14px",
        // 하단 그라디언트 + backdrop-blur 로 글래스 느낌
        background:
          "linear-gradient(to top, rgba(0,0,0,.68) 0%, rgba(0,0,0,.38) 55%, rgba(0,0,0,0) 100%)",
        opacity: hovered ? 1 : 0,
        transform: hovered ? "translateY(0)" : "translateY(8px)",
        // pointer-events 차단 → 숨겨진 상태에서 이미지 클릭/드래그 방해 X
        pointerEvents: hovered ? "auto" : "none",
        transition: "opacity .16s ease-out, transform .16s ease-out",
        display: "flex",
        alignItems: "center",
        justifyContent: summary ? "space-between" : "flex-end",
        gap: 12,
        color: "#fff",
      }}
    >
      {summary && (
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            lineHeight: 1.4,
            color: "rgba(255,255,255,.92)",
            overflow: "hidden",
          }}
        >
          {summary}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/* ─────────────────────────────────
   액션바 전용 아이콘 버튼 — 스타일 통일용
   ───────────────────────────────── */

export function ActionBarButton({
  icon,
  title,
  onClick,
  label,
  variant = "neutral",
  disabled,
}: {
  icon: IconName;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  /** 아이콘 옆 라벨 (생략 시 아이콘 only) */
  label?: string;
  variant?: "neutral" | "primary" | "danger";
  disabled?: boolean;
}) {
  const [hov, setHov] = useState(false);
  const palette = {
    neutral: {
      bg: "rgba(255,255,255,.14)",
      bgHov: "rgba(255,255,255,.24)",
    },
    primary: {
      bg: "rgba(74,158,255,.85)",
      bgHov: "rgba(74,158,255,1)",
    },
    danger: {
      bg: "rgba(255,255,255,.14)",
      bgHov: "rgba(192,57,43,.92)",
    },
  }[variant];

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        all: "unset",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: label ? 5 : 0,
        padding: label ? "6px 10px" : "7px 9px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: ".01em",
        color: "#fff",
        background: disabled ? "rgba(255,255,255,.06)" : hov ? palette.bgHov : palette.bg,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        border: "1px solid rgba(255,255,255,.18)",
        transition: "background .15s, transform .12s",
        transform: hov && !disabled ? "scale(1.04)" : "scale(1)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon name={icon} size={13} stroke={2.2} />
      {label && <span>{label}</span>}
    </button>
  );
}
