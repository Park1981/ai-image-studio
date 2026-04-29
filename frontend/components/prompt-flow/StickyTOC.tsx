/**
 * StickyTOC — 좌측 sticky 목차 (≥1280px).
 *
 * 페이지 안에서 길어진 콘텐츠 → 다이어그램/포인트로 빠른 점프.
 * 1280px 이하에선 자동으로 숨김 (StepGrid 가 1열로 stacking 되는 시점).
 */

"use client";

import { useEffect, useState } from "react";

export type TocItem = {
  id: string;
  label: string;
};

export default function StickyTOC({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  // 스크롤 위치에 따라 active 항목 추적 (가장 위쪽에 있는 섹션)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 가장 위쪽으로 들어온 섹션을 active 로 (rootMargin 으로 상단 고정)
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-20% 0px -65% 0px",
        threshold: [0, 0.25, 0.5],
      }
    );

    items.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [items]);

  const handleClick = (id: string) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav
      aria-label="페이지 내 빠른 이동 목차"
      className="ais-sticky-toc"
      style={{
        position: "sticky",
        top: 88,
        alignSelf: "flex-start",
        width: 220,
        maxHeight: "calc(100vh - 120px)",
        overflowY: "auto",
        padding: "16px 18px",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: ".18em",
          color: "var(--ink-4)",
          marginBottom: 12,
          fontFamily: "Consolas, SFMono-Regular, monospace",
        }}
      >
        ON THIS PAGE
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {items.map((item) => {
          const active = activeId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleClick(item.id)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "block",
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? "var(--accent-ink)" : "var(--ink-3)",
                  background: active ? "var(--accent-soft)" : "transparent",
                  borderLeft: active
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                  transition: "all .15s ease",
                  letterSpacing: 0,
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "var(--bg-2)";
                    e.currentTarget.style.color = "var(--ink-2)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--ink-3)";
                  }
                }}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
