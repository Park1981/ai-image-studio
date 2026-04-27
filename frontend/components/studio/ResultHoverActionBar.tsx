/**
 * ResultHoverActionBar — 결과 뷰어(이미지/영상) 하단 호버 액션바.
 * 2026-04-24 · 결과 영역 UX v2.
 *
 * 동작:
 *  - 부모 컨테이너가 hover 감지 → hovered prop 전달
 *  - 추가: 자손 버튼이 키보드 focus 받으면 자체적으로 보이게 (focus-within 패턴)
 *  - 페이드 인 (opacity + translateY) with backdrop-blur 글래스
 *  - 좌측 요약(summary) + 우측 버튼 slot
 *  - pointer-events 는 visible(hover || focus) 일 때만 활성 → 뷰어 상호작용 방해 X
 *
 * 2026-04-27 (C2-P1-8): 키보드 접근성 보강.
 *  - hover 전용 → focus-visible 자손이면 자동으로 액션바 보임.
 *  - Tab 으로 결과 뷰어 진입 시 ActionBarButton 들이 화면에 나타나며 사용 가능.
 *  - pointerEvents: none 은 mouse 만 차단 + tab focus 는 영향 없음 (브라우저 표준).
 *
 * 사용처: /generate, /edit, /video 결과 뷰어 공용.
 * 액션바 버튼은 ActionBarButton 서브컴포넌트 권장 (스타일 통일).
 */

"use client";

import { useState, type FocusEvent, type ReactNode } from "react";
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
  // 자손 버튼이 focus 받으면 visible — 키보드 사용자가 Tab 으로 도달 가능.
  const [focusWithin, setFocusWithin] = useState(false);
  const visible = hovered || focusWithin;

  function handleBlurCapture(e: FocusEvent<HTMLDivElement>) {
    // relatedTarget 이 액션바 내부면 focus 유지 — 자손 버튼 간 이동 시 깜빡임 방지.
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) {
      setFocusWithin(false);
    }
  }

  return (
    <div
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={handleBlurCapture}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "12px 14px",
        // 하단 그라디언트 + backdrop-blur 로 글래스 느낌
        background:
          "linear-gradient(to top, rgba(0,0,0,.68) 0%, rgba(0,0,0,.38) 55%, rgba(0,0,0,0) 100%)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        // pointer-events 차단 → 숨겨진 상태에서 이미지 클릭/드래그 방해 X
        // (focus 시 visible=true → auto 로 전환 → 키보드 사용자도 정상 클릭)
        pointerEvents: visible ? "auto" : "none",
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
  // focus-visible 만 추적 (마우스 클릭 시는 표시 안 함 — 키보드 사용자 전용 outline).
  const [focusVisible, setFocusVisible] = useState(false);
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
  const active = (hov || focusVisible) && !disabled;

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      // matches() 로 :focus-visible 만 분기 — 마우스 클릭 후 스타일 깜빡임 방지.
      onFocus={(e) => {
        try {
          if (e.currentTarget.matches(":focus-visible")) setFocusVisible(true);
        } catch {
          // 구형 브라우저 등 matches 미지원 폴백 — 항상 표시 (안전한 디폴트).
          setFocusVisible(true);
        }
      }}
      onBlur={() => setFocusVisible(false)}
      style={{
        all: "unset",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: label ? 5 : 0,
        padding: label ? "6px 10px" : "7px 9px",
        borderRadius: "var(--radius-full)",
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: ".01em",
        color: "#fff",
        background: disabled ? "rgba(255,255,255,.06)" : active ? palette.bgHov : palette.bg,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        // focus-visible 시 강조 outline (호버는 outline 없음 — 마우스 트래킹 방해 방지).
        border: focusVisible
          ? "1px solid rgba(255,255,255,.95)"
          : "1px solid rgba(255,255,255,.18)",
        outline: focusVisible ? "2px solid rgba(74,158,255,.85)" : "none",
        outlineOffset: focusVisible ? 2 : 0,
        transition: "background .15s, transform .12s, outline-color .15s",
        transform: active ? "scale(1.04)" : "scale(1)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon name={icon} size={13} stroke={2.2} />
      {label && <span>{label}</span>}
    </button>
  );
}
