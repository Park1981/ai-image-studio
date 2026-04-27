/**
 * Chrome - 공통 상단바/로고/모델 뱃지
 * Claude Design handoff 의 chrome.jsx 포팅
 *
 * Logo: 잉크 사각 + 액센트 점 커스텀 마크
 * TopBar: 좌/중/우 3영역 grid, sticky, backdrop-blur
 * IconBtn, BackBtn, ModelBadge: 다양한 상단바 요소
 */

"use client";

import type { ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

/* ── Logo ── 커스텀 마크 + 프로덕트명 + 런타임 뱃지 */
export function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: "var(--radius-sm)",
          background: "var(--ink)",
          display: "grid",
          placeItems: "center",
          position: "relative",
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: "var(--bg)",
            boxShadow: "inset 0 0 0 1.5px var(--ink)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--accent)",
            border: "2px solid var(--bg)",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.015em" }}>
          Image Studio
        </div>
        <div
          className="mono"
          style={{
            fontSize: 9,
            color: "var(--ink-3)",
            marginTop: 2,
            letterSpacing: ".08em",
          }}
        >
          LOCAL · v1.2.4
        </div>
      </div>
    </div>
  );
}

/* ── TopBar ── 3영역 sticky 헤더 */
export function TopBar({
  left,
  center,
  right,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header
      style={{
        height: 52,
        padding: "0 20px",
        borderBottom: "1px solid var(--line)",
        background: "rgba(250,249,247,.85)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        position: "sticky",
        top: 0,
        // z-index 위계 (2026-04-27 오빠 피드백): 헤더 30 > sticky CTA 20 > PromptHistoryPeek 5
        // → 헤더는 항상 viewport 가장 위 (시계 아이콘 / 잘린 텍스트 비집고 못 올라옴)
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>{left}</div>
      <div style={{ display: "flex", justifyContent: "center" }}>{center}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        {right}
      </div>
    </header>
  );
}

/* ── IconBtn ── 작은 아이콘 버튼 (hover 배경) */
export function IconBtn({
  icon,
  onClick,
  title,
  active = false,
}: {
  icon: IconName;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 32,
        height: 32,
        borderRadius: "var(--radius-sm)",
        border: "1px solid transparent",
        background: active ? "var(--bg-2)" : "transparent",
        color: "var(--ink-2)",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        transition: "all .15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = active
          ? "var(--bg-2)"
          : "transparent";
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/* ── BackBtn ── 메뉴로 돌아가기 버튼 */
export function BackBtn({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 30,
        padding: "0 10px 0 8px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        color: "var(--ink-2)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all .15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--line-2)";
        (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--line)";
        (e.currentTarget as HTMLButtonElement).style.background = "var(--surface)";
      }}
    >
      <Icon name="arrow-left" size={14} />
      메뉴
    </button>
  );
}

/* ── ModelBadge ── 상단 중앙 현재 모델 표시 */
export function ModelBadge({
  name = "Qwen Image 2512",
  status = "ready",
  tag = "GGUF·Q5",
}: {
  name?: string;
  status?: "ready" | "loading";
  tag?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 12px 5px 10px",
        borderRadius: "var(--radius-full)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        fontSize: 12,
        color: "var(--ink-2)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: status === "ready" ? "var(--green)" : "var(--amber)",
          boxShadow: `0 0 0 3px ${
            status === "ready" ? "rgba(82,196,26,.15)" : "rgba(250,173,20,.18)"
          }`,
        }}
      />
      <span style={{ fontWeight: 500, color: "var(--ink)" }}>{name}</span>
      <span
        className="mono"
        style={{ color: "var(--ink-4)", fontSize: 10, letterSpacing: ".04em" }}
      >
        {tag}
      </span>
    </div>
  );
}
