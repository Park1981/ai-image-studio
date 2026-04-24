"use client";

import type { CSSProperties, ReactNode } from "react";

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
