"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * 반응형 정책 (P0-1 · 2026-04-26):
 *   - 최소 지원 viewport: 1024px (노트북부터, 모바일 미지원)
 *   - 1024px = floor (좌패널 400 + 우패널 624 정확 fit)
 *   - >1024px = 우패널 자동 확장 (minmax 1fr)
 *   - <1024px = 미지원 (가로 스크롤 또는 깨짐 — 의도된 제약)
 *
 * 메인 메뉴 (app/page.tsx) 는 별도 breakpoint:
 *   ≥1280: 3열 / 1024-1280: 2열 (globals.css `.ais-menu-grid`)
 */
export const STUDIO_MIN_WIDTH = 1024;
export const STUDIO_GRID_COLUMNS = "400px minmax(624px, 1fr)";
export const STUDIO_LEFT_PANEL_PADDING = "24px 20px";
export const STUDIO_RIGHT_PANEL_PADDING = "24px 32px";
export const STUDIO_PANEL_GAP = 18;

export function StudioPage({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        minWidth: STUDIO_MIN_WIDTH,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StudioWorkspace({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: STUDIO_GRID_COLUMNS,
        minHeight: "calc(100vh - 52px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StudioLeftPanel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        padding: STUDIO_LEFT_PANEL_PADDING,
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        gap: STUDIO_PANEL_GAP,
        background: "var(--bg)",
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function StudioModeHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "2px 0 4px",
      }}
    >
      <h1
        className="display"
        style={{
          margin: 0,
          fontSize: 21,
          fontWeight: 650,
          color: "var(--ink)",
          letterSpacing: 0,
          lineHeight: 1.05,
          fontVariationSettings: '"opsz" 72, "SOFT" 42, "WONK" 0',
        }}
      >
        {title}
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 500,
          color: "var(--ink-3)",
          lineHeight: 1.45,
          letterSpacing: 0,
        }}
      >
        {description}
      </p>
    </div>
  );
}

export function StudioRightPanel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        padding: STUDIO_RIGHT_PANEL_PADDING,
        display: "flex",
        flexDirection: "column",
        gap: STUDIO_PANEL_GAP,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </section>
  );
}
