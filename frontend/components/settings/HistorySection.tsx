/**
 * HistorySection — 저장된 기록 통계 + 모드별 분해 + 모두 삭제.
 *
 * Phase 3.2 추출 (refactor doc 2026-04-30 §I2) — 옛 SettingsDrawer.tsx 의
 * HistorySection / HistoryModeRow + fmtBytes helper.
 */

"use client";

import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";
import { clearHistory as apiClearHistory, getHistoryStats } from "@/lib/api/history";
import type { HistoryStats } from "@/lib/api/types";
import Section from "./Section";

/** 바이트 → 사람 친화 문자열 (KB/MB/GB). */
function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function HistorySection() {
  const count = useHistoryStore((s) => s.items.length);
  const clear = useHistoryStore((s) => s.clear);

  // 서버 통계 — 설정 열릴 때마다 1회 + 30초 주기 갱신.
  const [stats, setStats] = useState<HistoryStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const s = await getHistoryStats();
      if (!cancelled) setStats(s);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleClear = async () => {
    if (count === 0) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `히스토리 ${count}개를 모두 삭제할까요? (되돌릴 수 없음)`,
      );
      if (!ok) return;
    }
    try {
      await apiClearHistory();
    } catch (e) {
      toast.warn(
        "서버 히스토리 삭제 실패",
        e instanceof Error ? e.message : "로컬만 비움",
      );
    }
    clear();
    setStats({
      count: 0,
      totalSizeBytes: 0,
      dbSizeBytes: stats?.dbSizeBytes ?? 0,
      byMode: {
        generate: { count: 0, sizeBytes: 0 },
        edit: { count: 0, sizeBytes: 0 },
        video: { count: 0, sizeBytes: 0 },
      },
    });
    toast.success("히스토리 비워짐");
  };

  const displayCount = stats?.count ?? count;
  const totalSize = stats?.totalSizeBytes ?? 0;
  const dbSize = stats?.dbSizeBytes ?? 0;

  return (
    <Section
      num="04"
      title="히스토리"
      titleEn="Archive"
      meta="SQLITE · v8"
      desc="생성/수정/영상 기록 + 디스크 사용량"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        {/* 상단 — 총 갯수 + 총 용량 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
              저장된 기록
            </span>
            <span
              className="mono"
              style={{ fontSize: 10.5, color: "var(--ink-4)" }}
            >
              DB {fmtBytes(dbSize)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              className="mono"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--ink)",
              }}
            >
              {displayCount}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                fontWeight: 500,
              }}
            >
              {fmtBytes(totalSize)}
            </span>
          </div>
        </div>

        {/* 모드별 분해 */}
        {stats && (
          <>
            <HistoryModeRow
              icon="image"
              accent="#3b82f6"
              label="이미지 생성"
              count={stats.byMode.generate.count}
              sizeBytes={stats.byMode.generate.sizeBytes}
            />
            <HistoryModeRow
              icon="wand"
              accent="#8b5cf6"
              label="이미지 수정"
              count={stats.byMode.edit.count}
              sizeBytes={stats.byMode.edit.sizeBytes}
            />
            <HistoryModeRow
              icon="play"
              accent="#f43f5e"
              label="영상 생성"
              count={stats.byMode.video.count}
              sizeBytes={stats.byMode.video.sizeBytes}
              divider={false}
            />
          </>
        )}

        {/* 하단 액션 */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "8px 12px",
            background: "var(--bg-2)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            onClick={handleClear}
            disabled={displayCount === 0}
            style={{
              all: "unset",
              cursor: displayCount === 0 ? "not-allowed" : "pointer",
              padding: "5px 10px",
              fontSize: 11.5,
              fontWeight: 500,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              background: "var(--bg)",
              color: displayCount === 0 ? "var(--ink-4)" : "#C0392B",
              opacity: displayCount === 0 ? 0.5 : 1,
            }}
          >
            모두 삭제
          </button>
        </div>
      </div>
    </Section>
  );
}

function HistoryModeRow({
  icon,
  accent,
  label,
  count,
  sizeBytes,
  divider = true,
}: {
  icon: IconName;
  accent: string;
  label: string;
  count: number;
  sizeBytes: number;
  divider?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderBottom: divider ? "1px solid var(--line)" : "none",
        opacity: count === 0 ? 0.55 : 1,
      }}
    >
      <span
        aria-hidden
        style={{ color: accent, display: "inline-flex", flexShrink: 0 }}
      >
        <Icon name={icon} size={14} stroke={1.7} />
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          fontWeight: 500,
          flex: 1,
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          color: "var(--ink)",
          fontWeight: 600,
          minWidth: 30,
          textAlign: "right",
        }}
      >
        {count}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          minWidth: 60,
          textAlign: "right",
        }}
      >
        {fmtBytes(sizeBytes)}
      </span>
    </div>
  );
}
