/**
 * Section — SettingsDrawer 의 섹션 공용 wrapper.
 * 좌측 accent 세로 바 + 타이틀 (큰/진한) + desc (작은/옅은).
 *
 * Phase 3.2 추출 (refactor doc 2026-04-30 §I2) — 옛 SettingsDrawer.tsx (1466줄) 분할.
 */

import type { ReactNode } from "react";

export default function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* 헤더 — 좌측 accent 세로 바 + 타이틀 (큰/진한) + desc (작은/옅은). */}
      <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
        <div
          aria-hidden
          style={{
            width: 3,
            background: "var(--accent)",
            borderRadius: 2,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: "-.005em",
              lineHeight: 1.2,
            }}
          >
            {title}
          </div>
          {desc && (
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                marginTop: 3,
                lineHeight: 1.35,
              }}
            >
              {desc}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </section>
  );
}
