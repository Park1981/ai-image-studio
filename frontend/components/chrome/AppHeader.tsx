/**
 * AppHeader — 모든 페이지 공용 통합 헤더.
 *
 * Phase 2 (V5 · 2026-05-02 · 결정 M):
 *   - HomeBtn 좌측 *제거* (시안 v7 부터 ModeNav 첫 chip 으로 흡수).
 *   - 중앙에 <ModeNav /> 6 chip — Home / Generate / Edit / Video / Analyze / Compare.
 *   - Logo 텍스트 → Fraunces italic 14 (Chrome.tsx · `.ais-ah-logo-name`).
 *   - SettingsButton / ShutdownButton ghost 톤 통일 (이미 OK · 그대로 유지).
 *
 * 우측 영역 순서 (오빠 결정 7 · 보존):
 *   [MockBadge?][SystemStatusChip][SystemMetrics][SettingsButton][ShutdownButton]
 *
 * 회귀 위험 보존:
 *   - 9: MockBadge / StatusChip 조건부 노출 — `USE_MOCK / running grace` 그대로.
 *   - 11: V5 시각 대상 inline style → className (TopBar/Logo/ModeNav 본체 inline 0).
 *
 * 2026-04-26 신설 — 6 페이지 동일 TopBar 패턴 통합.
 * 2026-04-30 (Phase 3.3) — ShutdownBtn / Overlay 분리 → ShutdownButton.tsx.
 * 2026-05-02 (Phase 2 · V5) — HomeBtn 흡수 + ModeNav 신설 + Logo italic className.
 */

"use client";

import { Logo, TopBar } from "./Chrome";
import ModeNav from "./ModeNav";
import SettingsButton from "@/components/settings/SettingsButton";
import SystemMetrics from "./SystemMetrics";
import SystemStatusChip from "./SystemStatusChip";
import ShutdownButton from "./ShutdownButton";
import { USE_MOCK } from "@/lib/api/client";

/** Mock 모드 표시 chip — `NEXT_PUBLIC_USE_MOCK=true` 환경에서만 노출.
 *  V5 V6 단계에서 className 으로 격상 가능하나 운영/디자인 본체 외 운영 도구라 inline 유지. */
function MockModeBadge() {
  if (!USE_MOCK) return null;

  return (
    <div
      role="status"
      title="NEXT_PUBLIC_USE_MOCK=true"
      style={{
        display: "flex",
        alignItems: "center",
        height: 26,
        padding: "0 9px",
        borderRadius: "var(--radius-full)",
        border: "1px solid rgba(245,158,11,.42)",
        background: "rgba(245,158,11,.10)",
        color: "var(--amber-ink)",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: ".06em",
        whiteSpace: "nowrap",
      }}
    >
      MOCK
    </div>
  );
}

export default function AppHeader() {
  return (
    <TopBar
      left={<Logo />}
      center={<ModeNav />}
      right={
        <>
          <MockModeBadge />
          <SystemStatusChip />
          <SystemMetrics />
          <SettingsButton />
          <ShutdownButton />
        </>
      }
    />
  );
}
