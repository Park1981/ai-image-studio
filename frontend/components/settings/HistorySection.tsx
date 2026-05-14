/**
 * HistorySection — 저장된 기록 통계 + 모드별 분해 + 모두 삭제.
 *
 * 2026-05-14 Phase 3 (Editorial Archive): hero number (Fraunces italic
 *   큰 숫자) + 우측 mono 총 용량 + 모드별 grid 4-col + 하단 danger CTA.
 *
 * Phase 3.2 추출 (refactor doc 2026-04-30 §I2) — 옛 SettingsDrawer.tsx 의
 * HistorySection / HistoryModeRow + fmtBytes helper.
 */

"use client";

import { useEffect, useState } from "react";
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
      <div className="ais-hist-frame">
        {/* Hero — 큰 숫자 + 총 용량 + DB 크기 */}
        <div className="ais-hist-hero">
          <div className="ais-hist-hero-num">
            <span className="big">{displayCount}</span>
            <span className="sub">total · saved</span>
          </div>
          <div className="ais-hist-hero-size">
            <span className="size">{fmtBytes(totalSize)}</span>
            <span className="db">DB · {fmtBytes(dbSize)}</span>
          </div>
        </div>

        {/* 모드별 분해 */}
        {stats && (
          <div className="ais-hist-modes">
            <HistoryModeRow
              glyph="🖼"
              label="이미지 생성"
              count={stats.byMode.generate.count}
              sizeBytes={stats.byMode.generate.sizeBytes}
            />
            <HistoryModeRow
              glyph="✦"
              label="이미지 수정"
              count={stats.byMode.edit.count}
              sizeBytes={stats.byMode.edit.sizeBytes}
            />
            <HistoryModeRow
              glyph="▷"
              label="영상 생성"
              count={stats.byMode.video.count}
              sizeBytes={stats.byMode.video.sizeBytes}
            />
          </div>
        )}

        {/* 하단 액션 */}
        <div className="ais-hist-foot">
          <button
            type="button"
            onClick={handleClear}
            disabled={displayCount === 0}
            className="ais-btn-danger"
            style={
              displayCount === 0
                ? { opacity: 0.45, cursor: "not-allowed" }
                : undefined
            }
          >
            ⌫ 모두 삭제
          </button>
        </div>
      </div>
    </Section>
  );
}

function HistoryModeRow({
  glyph,
  label,
  count,
  sizeBytes,
}: {
  glyph: string;
  label: string;
  count: number;
  sizeBytes: number;
}) {
  return (
    <div
      className="ais-hist-mode"
      style={count === 0 ? { opacity: 0.5 } : undefined}
    >
      <span className="glyph" aria-hidden="true">{glyph}</span>
      <span className="lbl">{label}</span>
      <span className="count">{count}</span>
      <span className="sz">{fmtBytes(sizeBytes)}</span>
    </div>
  );
}
