/**
 * MenuCard - 메인 메뉴의 모드 선택 카드
 *
 * 2026-04-24 리디자인:
 *  - bgImage prop 으로 배경 이미지 지원 → 상단 70% 이미지, 하단 30% 본문
 *  - hover 시 이미지 zoom(1.05) + 밝기↑ + shadow-md
 *  - disabled 시 grayscale + opacity 낮춤 ("준비 중" 인상)
 *
 * bgImage 없이 쓰면 기존 아이콘 박스 + 텍스트 레이아웃 (backward-compat).
 */

"use client";

import { useState } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

interface MenuCardProps {
  icon: IconName;
  title: string;
  desc: string;
  tag?: string;
  disabled?: boolean;
  onClick?: () => void;
  /** 아이콘 박스 tint 색 (bgImage 없을 때만 의미 있음). */
  hue?: string;
  /**
   * 배경 이미지 URL (public 기준 경로, 예: "/menu/generate.png").
   * 있으면 카드가 풀 이미지 모드 — 상단 70% 이미지 + 하단 30% 본문 오버레이.
   */
  bgImage?: string;
}

export default function MenuCard({
  icon,
  title,
  desc,
  tag,
  disabled = false,
  onClick,
  hue = "#EAF3FF",
  bgImage,
}: MenuCardProps) {
  const [hover, setHover] = useState(false);

  /* ─────────────── bgImage 모드 ─────────────── */
  if (bgImage) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled}
        onMouseEnter={() => !disabled && setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={disabled ? undefined : onClick}
        style={{
          all: "unset",
          cursor: disabled ? "not-allowed" : "pointer",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          background: "var(--surface)",
          border: `1px solid ${hover ? "var(--line-2)" : "var(--line)"}`,
          boxShadow: disabled
            ? "none"
            : hover
              ? "var(--shadow-md)"
              : "var(--shadow-sm)",
          transition: "all .2s ease",
          opacity: disabled ? 0.78 : 1,
          transform: hover && !disabled ? "translateY(-2px)" : "translateY(0)",
          minHeight: 340,
        }}
      >
        {/* 배경 이미지 영역 (상단 ~68%) */}
        <div
          style={{
            position: "relative",
            aspectRatio: "16 / 11",
            width: "100%",
            overflow: "hidden",
            background: "#0c0c10",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bgImage}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              filter: disabled
                ? "grayscale(.6) brightness(.9)"
                : hover
                  ? "brightness(1.06) saturate(1.05)"
                  : "brightness(1)",
              transform: hover && !disabled ? "scale(1.04)" : "scale(1)",
              transition: "transform .35s cubic-bezier(.2,.7,.3,1), filter .2s",
            }}
          />
          {/* 하단 그라디언트 — 텍스트 가독성 + 부드러운 전환 */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0) 55%, rgba(10,12,16,.72) 100%)",
              pointerEvents: "none",
            }}
          />
          {/* 2026-04-25: 좌상단 아이콘 pill + 우상단 태그 모두 제거 — 신규 인물 시리즈 사진이
              의미 전달하니 오버레이 노이즈 최소화. disabled 카드는 grayscale + "곧 만나요" 로 안내. */}
        </div>

        {/* 본문 영역 (하단 ~32%) */}
        <div
          style={{
            padding: "16px 20px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flex: 1,
          }}
        >
          <div
            className="display"
            style={{
              fontSize: 19,
              fontWeight: 650,
              letterSpacing: 0,
              color: "var(--ink)",
              lineHeight: 1.12,
              fontVariationSettings: '"opsz" 72, "SOFT" 42, "WONK" 0',
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-3)",
              lineHeight: 1.5,
              letterSpacing: 0,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              // 1줄/2줄 desc 가 섞여도 카드 높이 일정하게 — 2줄 공간 상시 reserve
              minHeight: "calc(1.5em * 2)",
            }}
          >
            {desc}
          </div>
          <div
            style={{
              marginTop: "auto",
              paddingTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: disabled
                ? "var(--ink-4)"
                : hover
                  ? "var(--accent-ink)"
                  : "var(--ink-2)",
              transition: "color .2s",
            }}
          >
            {disabled ? "곧 만나요" : "시작하기"}
            {!disabled && (
              <Icon
                name="arrow-right"
                size={13}
                style={{
                  transform: hover ? "translateX(4px)" : "translateX(0)",
                  transition: "transform .2s",
                }}
              />
            )}
          </div>
        </div>
      </button>
    );
  }

  /* ─────────────── 기존 텍스트 카드 (backward-compat) ─────────────── */
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={disabled ? undefined : onClick}
      style={{
        all: "unset",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        flexDirection: "column",
        padding: "32px 28px 28px",
        borderRadius: "var(--radius-lg)",
        background: disabled ? "transparent" : "var(--surface)",
        border: disabled
          ? "1.5px dashed var(--line-2)"
          : `1px solid ${hover ? "var(--line-2)" : "var(--line)"}`,
        boxShadow: disabled ? "none" : hover ? "var(--shadow-md)" : "var(--shadow-sm)",
        transition: "all .2s ease",
        opacity: disabled ? 0.55 : 1,
        transform: hover && !disabled ? "translateY(-2px)" : "translateY(0)",
        minHeight: 280,
        position: "relative",
      }}
    >
      {tag && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            padding: "3px 9px",
            background: "var(--bg-2)",
            border: "1px solid var(--line-2)",
            borderRadius: "var(--radius-full)",
            fontSize: 10.5,
            fontWeight: 500,
            color: "var(--ink-3)",
            letterSpacing: ".02em",
          }}
        >
          {tag}
        </div>
      )}

      {/* 아이콘 블록 */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "var(--radius)",
          background: disabled ? "#EEEAE2" : hue,
          display: "grid",
          placeItems: "center",
          color: disabled ? "var(--ink-4)" : "var(--ink)",
          marginBottom: 28,
          transition: "all .2s",
        }}
      >
        <Icon name={icon} size={24} stroke={1.5} />
      </div>

      <div
        className="display"
        style={{
          fontSize: 20,
          fontWeight: 650,
          letterSpacing: 0,
          marginBottom: 8,
          color: "var(--ink)",
          lineHeight: 1.12,
          fontVariationSettings: '"opsz" 72, "SOFT" 42, "WONK" 0',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "var(--ink-3)",
          lineHeight: 1.55,
          marginBottom: 24,
          flex: 1,
        }}
      >
        {desc}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 500,
          color: disabled
            ? "var(--ink-4)"
            : hover
              ? "var(--accent-ink)"
              : "var(--ink-2)",
          transition: "all .2s",
        }}
      >
        {disabled ? "곧 만나요" : "시작하기"}
        {!disabled && (
          <Icon
            name="arrow-right"
            size={14}
            style={{
              transform: hover ? "translateX(3px)" : "translateX(0)",
              transition: "transform .2s",
            }}
          />
        )}
      </div>
    </button>
  );
}
