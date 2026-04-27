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
 * 2026-04-27 (UX 폴리시 · 통통 튀는 액션 바):
 *  - 바닥 그라디언트 → 글래스 pill 형태 (살짝 떠서 부유감)
 *  - 등장 spring easing (back-out cubic-bezier 0.34 / 1.56 / 0.64 / 1) — 통통
 *  - hover 시 살짝 작아진 상태(0.92)에서 normal scale + translateY 14 → 0
 *  - summary 기본 비표시 (요약은 ImageLightbox 메타 패널 / InfoModal 에서 보면 됨)
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
  /** 좌측 요약 영역 (선택). 기본 비표시 — 호출처가 명시적으로 넘길 때만. */
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
        // 살짝 띄움 — 바닥에서 12px / 좌우 16px 안쪽 여백 → 부유감
        left: 16,
        right: 16,
        bottom: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: summary ? "space-between" : "center",
        gap: 12,
        // 2026-04-27 오빠 피드백: opacity transition 제거.
        //  Chrome 렌더링 이슈 — opacity 0→1 transition 중 backdrop-filter 가 점진 적용되며
        //  처음 ~150ms 는 frosted 효과 없이 탁한 회색 배경으로 보이다가 transition 끝난 뒤에야
        //  진짜 frosted glass 효과 활성. 두 단계로 "탁함 → 유리" 변동으로 인지됨.
        //  → opacity 는 instant 토글, transform spring 만 transition → backdrop-filter 처음부터 활성.
        opacity: visible ? 1 : 0,
        transform: visible
          ? "translateY(0) scale(1)"
          : "translateY(14px) scale(0.92)",
        pointerEvents: visible ? "auto" : "none",
        transition: visible
          ? "transform .26s cubic-bezier(0.34, 1.56, 0.64, 1)"
          : "transform .18s ease-out",
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
            // frosted glass — 요약 pill (2026-04-27 강화: blur 18 + saturate · 더 투명)
            padding: "8px 12px",
            background: "rgba(28,30,38,.32)",
            backdropFilter: "blur(18px) saturate(180%)",
            WebkitBackdropFilter: "blur(18px) saturate(180%)",
            borderRadius: "var(--radius-full)",
            border: "1px solid rgba(255,255,255,.18)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.08)",
          }}
        >
          {summary}
        </div>
      )}
      {/* 버튼 그룹 = frosted glass pill — 부유감 + 유리 강조 */}
      <div
        style={{
          display: "flex",
          gap: 4,
          flexShrink: 0,
          padding: 4,
          // 2026-04-27 글래스 강화: background 더 투명 (.62 → .32) + blur 18 + saturate 180%
          // → 진짜 frosted glass 느낌 (Apple/iOS 스타일)
          background: "rgba(28,30,38,.32)",
          backdropFilter: "blur(18px) saturate(180%)",
          WebkitBackdropFilter: "blur(18px) saturate(180%)",
          borderRadius: "var(--radius-full)",
          // edge highlight — 유리 가장자리 광 효과
          border: "1px solid rgba(255,255,255,.22)",
          boxShadow:
            "0 8px 28px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.12)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────────────
   액션바 전용 아이콘 버튼 — 스타일 통일용
   2026-04-27: pill 그룹 안에 들어가 있으므로 자체 배경 옅게 + outline 제거
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
  // 2026-04-27 오빠 피드백: 모든 variant 평소 transparent → 일관성 ↑ + 호버 진입 시 깜빡임 차단.
  // 이전: primary 만 평소 .78 파란색이 미리 들어가 있어 (1) 다른 버튼과 통일감 깨짐
  //       (2) 등장 transition 과 ActionBarButton 자체 hover transition 이 동시 진행되며
  //       0.1~0.2초 동안 두 색이 겹쳐 보이는 깜빡임 발생. 평소 transparent 로 두면 해결.
  const palette = {
    neutral: {
      bg: "transparent",
      bgHov: "rgba(255,255,255,.16)",
    },
    primary: {
      bg: "transparent",
      bgHov: "rgba(74,158,255,.85)",
    },
    danger: {
      bg: "transparent",
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
        padding: label ? "6px 12px" : "8px 9px",
        borderRadius: "var(--radius-full)",
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: ".01em",
        color: "#fff",
        background: disabled ? "rgba(255,255,255,.06)" : active ? palette.bgHov : palette.bg,
        // focus-visible 시 강조 outline (호버는 outline 없음 — 마우스 트래킹 방해 방지).
        outline: focusVisible ? "2px solid rgba(74,158,255,.85)" : "none",
        outlineOffset: focusVisible ? 2 : 0,
        transition:
          "background .18s ease, transform .22s cubic-bezier(0.34, 1.56, 0.64, 1)",
        // 버튼 자체도 살짝 통통 — hover 시 1.06x
        transform: active ? "scale(1.08)" : "scale(1)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon name={icon} size={13} stroke={2.2} />
      {label && <span>{label}</span>}
    </button>
  );
}
