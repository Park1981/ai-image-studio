/**
 * MenuCard - 메인 메뉴의 3장짜리 모드 선택 카드
 * hover 시 살짝 들뜨면서 shadow-md, 비활성 시 dashed 테두리
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
  hue?: string; // 아이콘 박스 배경색
}

export default function MenuCard({
  icon,
  title,
  desc,
  tag,
  disabled = false,
  onClick,
  hue = "#EAF3FF",
}: MenuCardProps) {
  const [hover, setHover] = useState(false);

  return (
    <button
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={disabled ? undefined : onClick}
      style={{
        all: "unset",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        flexDirection: "column",
        padding: "32px 28px 28px",
        borderRadius: 16,
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
            borderRadius: 999,
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
          borderRadius: 12,
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
        style={{
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          marginBottom: 8,
          color: "var(--ink)",
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
