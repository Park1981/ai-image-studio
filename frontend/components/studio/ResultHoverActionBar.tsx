/**
 * ResultHoverActionBar — 결과 뷰어(이미지/영상) 하단 호버 액션바.
 * 2026-04-24 · 결과 영역 UX v2.
 *
 * 동작:
 *  - 부모 컨테이너가 hover 감지 → hovered prop 전달
 *  - 추가: 자손 버튼이 키보드 focus 받으면 자체적으로 보이게 (focus-within 패턴)
 *  - 페이드 인 (opacity + translateY) with backdrop-blur 글래스
 *  - 좌측 요약(summary) + 우측 버튼 slot (summary 가 있을 때만 두 pill 패턴 — legacy support)
 *  - pointer-events 는 visible(hover || focus) 일 때만 활성 → 뷰어 상호작용 방해 X
 *
 * 2026-04-27 (C2-P1-8): 키보드 접근성 보강.
 *  - hover 전용 → focus-visible 자손이면 자동으로 액션바 보임. (회귀 위험 #3 보존)
 *  - Tab 으로 결과 뷰어 진입 시 ActionBarButton 들이 화면에 나타나며 사용 가능.
 *
 * 2026-05-02 디자인 V5 Phase 4 격상:
 *  - frosted glass body inline → className `.ais-result-action-bar` (hero) / `.ais-tile-action-bar` (tile)
 *  - V5 가운데 정렬 (`translateX(-50%)` · 옛 left:16/right:16 대신)
 *  - visibility (opacity/transform/pointerEvents) 는 동적이라 inline 유지 (plan v4 변경 #4 — 동적 계산 허용)
 *  - variant prop 추가 — "hero" (Hero 결과 뷰어 자체 액션바) / "tile" (HistoryTile 호버 액션바)
 *  - summary 가 있을 때만 옛 두 pill 패턴 (legacy support — 호출처 미사용 시에도 호환 유지)
 *
 * 사용처: /generate, /edit, /video 결과 뷰어 + 4 페이지 히스토리 타일.
 */

"use client";

import { useState, type FocusEvent, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

interface Props {
  /** 부모 컨테이너의 호버 상태. 부모가 onMouseEnter/Leave 로 관리. */
  hovered: boolean;
  /** 좌측 요약 영역 (선택). 기본 비표시 — 호출처가 명시적으로 넘길 때만 옛 두 pill 패턴 활성. */
  summary?: ReactNode;
  /** 우측 버튼 slot. ActionBarButton 권장. */
  children: ReactNode;
  /**
   * V5 variant — Hero 결과 뷰어 본체용 (`hero`, 기본) / HistoryTile 호버용 (`tile`).
   * className 만 다르고 동작 (visibility + spring) 은 동일.
   */
  variant?: "hero" | "tile";
}

/** V5 spring transform — visible/invisible 두 state. translateX(-50%) 가운데 정렬 보존. */
const TRANSFORM_VISIBLE = "translateX(-50%) translateY(0) scale(1)";
const TRANSFORM_HIDDEN = "translateX(-50%) translateY(8px) scale(0.92)";

export default function ResultHoverActionBar({
  hovered,
  summary,
  children,
  variant = "hero",
}: Props) {
  // 자손 버튼이 focus 받으면 visible — 키보드 사용자가 Tab 으로 도달 가능. (회귀 위험 #3 보존)
  const [focusWithin, setFocusWithin] = useState(false);
  const visible = hovered || focusWithin;

  function handleBlurCapture(e: FocusEvent<HTMLDivElement>) {
    // relatedTarget 이 액션바 내부면 focus 유지 — 자손 버튼 간 이동 시 깜빡임 방지.
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) {
      setFocusWithin(false);
    }
  }

  // summary 있으면 옛 두 pill 패턴 (legacy fallback) — V5 className 미적용.
  if (summary) {
    return (
      <div
        onFocusCapture={() => setFocusWithin(true)}
        onBlurCapture={handleBlurCapture}
        style={{
          position: "absolute",
          left: 16,
          right: 16,
          bottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0) scale(1)" : "translateY(14px) scale(0.92)",
          pointerEvents: visible ? "auto" : "none",
          transition: visible
            ? "transform .26s cubic-bezier(0.34, 1.56, 0.64, 1)"
            : "transform .18s ease-out",
          color: "#fff",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            lineHeight: 1.4,
            color: "rgba(255,255,255,.92)",
            overflow: "hidden",
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
        <div
          style={{
            display: "flex",
            gap: 4,
            flexShrink: 0,
            padding: 4,
            background: "rgba(28,30,38,.32)",
            backdropFilter: "blur(18px) saturate(180%)",
            WebkitBackdropFilter: "blur(18px) saturate(180%)",
            borderRadius: "var(--radius-full)",
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

  // V5 default: single pill 패턴 (frosted glass body 는 className CSS 가 처리).
  // visibility 만 inline (React state 기반). Hero/Tile 위치 등은 className 별 CSS 가 분기.
  const className =
    variant === "tile" ? "ais-tile-action-bar" : "ais-result-action-bar";
  return (
    <div
      className={className}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={handleBlurCapture}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? TRANSFORM_VISIBLE : TRANSFORM_HIDDEN,
        pointerEvents: visible ? "auto" : "none",
        transition: visible
          ? "transform .26s cubic-bezier(0.34, 1.56, 0.64, 1), opacity .18s ease"
          : "transform .18s ease-out, opacity .15s ease",
      }}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────
   액션바 전용 아이콘 버튼 — 스타일 통일용
   2026-04-27: pill 그룹 안에 들어가 있으므로 자체 배경 옅게 + outline 제거
   2026-05-02 V5 Phase 4 codex fix #1: inline style → className `.ais-result-action-btn` /
     `.ais-tile-action-btn` + data-attribute (variant/active/focus-visible/disabled/has-label).
     CSS 가 size (34/26) + variant 별 hover bg + spring transform + label padding + focus outline 처리.
   ───────────────────────────────── */

export function ActionBarButton({
  icon,
  title,
  onClick,
  label,
  variant = "neutral",
  disabled,
  size = "hero",
}: {
  icon: IconName;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  /** 아이콘 옆 라벨 (생략 시 아이콘 only) */
  label?: string;
  variant?: "neutral" | "primary" | "danger";
  disabled?: boolean;
  /** V5 Phase 4 — Hero (34×34) / Tile (26×26) — 부모 ResultHoverActionBar variant 와 매칭 */
  size?: "hero" | "tile";
}) {
  const [hov, setHov] = useState(false);
  // focus-visible 만 추적 (마우스 클릭 시는 표시 안 함 — 키보드 사용자 전용 outline).
  const [focusVisible, setFocusVisible] = useState(false);
  const active = (hov || focusVisible) && !disabled;
  const className = size === "tile" ? "ais-tile-action-btn" : "ais-result-action-btn";

  return (
    <button
      type="button"
      className={className}
      title={title}
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-active={active ? "true" : "false"}
      data-focus-visible={focusVisible ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
      data-has-label={label ? "true" : "false"}
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
    >
      <Icon name={icon} size={13} stroke={2.2} />
      {label && <span>{label}</span>}
    </button>
  );
}
