/**
 * JumpToDiagramFab — 우하단 floating "다이어그램으로 이동" 버튼.
 *
 * 페이지 스크롤이 충분히 내려갔을 때만 표시 (fade in).
 * 클릭 시 지정된 섹션으로 smooth scroll.
 */

"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";

export default function JumpToDiagramFab({
  targetId,
  label = "다이어그램 보기",
}: {
  targetId: string;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setVisible(window.scrollY > 280);
    };
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const onClick = () => {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        all: "unset",
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 50,
        display: visible ? "inline-flex" : "none",
        alignItems: "center",
        gap: 8,
        padding: "11px 18px",
        borderRadius: "var(--radius-full)",
        background: "var(--ink)",
        color: "#FFFFFF",
        boxShadow: "var(--shadow-lg)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 0,
        transition: "all .15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.background = "var(--accent-ink)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.background = "var(--ink)";
      }}
    >
      <Icon name="grid" size={16} />
      <span>{label}</span>
    </button>
  );
}
