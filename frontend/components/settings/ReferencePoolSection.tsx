/**
 * ReferencePoolSection — Edit 사용자 직접 업로드 reference 의 임시 풀 사용량 + 고아 일괄 삭제.
 *
 * Phase 3.2 추출 (refactor doc 2026-04-30 §I2) — 옛 SettingsDrawer.tsx 의
 * ReferencePoolSection. v9 plan (2026-04-29 · Phase D.1) 기반.
 */

"use client";

import { useEffect, useState } from "react";
import { toast } from "@/stores/useToastStore";
import Section from "./Section";

export default function ReferencePoolSection() {
  const [stats, setStats] = useState<{ count: number; totalBytes: number } | null>(null);
  const [orphanCount, setOrphanCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([
        import("@/lib/api/reference-pool").then((m) => m.getPoolStats()),
        import("@/lib/api/reference-pool").then((m) => m.getPoolOrphans()),
      ]);
      setStats(s);
      setOrphanCount(o.count);
    } catch (e) {
      toast.error("참조 풀 로드 실패", e instanceof Error ? e.message : "unknown");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleDeleteOrphans = async () => {
    if (orphanCount === 0 || busy) return;
    if (!window.confirm(`고아 참조 ${orphanCount}개를 일괄 삭제할까요?\n(history 에 연결된 참조는 보존됩니다)`)) {
      return;
    }
    setBusy(true);
    try {
      const { deletePoolOrphans } = await import("@/lib/api/reference-pool");
      const r = await deletePoolOrphans();
      toast.success("일괄 삭제 완료", `${r.deleted}개 삭제됨`);
      await refresh();
    } catch (e) {
      toast.error("삭제 실패", e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const mb = stats ? (stats.totalBytes / 1024 / 1024).toFixed(1) : "—";

  return (
    <Section
      num="05"
      title="참조 임시 캐시"
      titleEn="Refs · Cache"
      meta="EDIT · POOL"
      desc="Edit 사용자 직접 업로드 reference 의 임시 풀"
    >
      {/* Editorial cache card (2026-05-14 Phase 3):
       *   상단 head — 총 갯수/용량 + 우측 orphan chip
       *   center — 일괄 삭제 CTA (orphan 0 또는 busy 시 disabled)
       *   하단 notes — 안전성 안내 ※ 2 줄 */}
      <div className="ais-cache-card">
        <div className="ais-cache-head">
          <span className="ais-cache-total">
            {loading
              ? "로딩 중…"
              : stats
                ? <>총 <span className="num">{stats.count}</span>개 · <span className="num">{mb}</span> MB</>
                : "—"}
          </span>
          {orphanCount > 0 && (
            <span className="ais-cache-orphan">orphan {orphanCount}</span>
          )}
        </div>
        <div className="ais-cache-action">
          <button
            type="button"
            onClick={() => void handleDeleteOrphans()}
            disabled={busy || orphanCount === 0}
            className="ais-cache-cta"
          >
            {busy
              ? "삭제 중…"
              : orphanCount === 0
                ? "고아 참조 없음"
                : `⌫ 고아 참조 ${orphanCount}개 일괄 삭제`}
          </button>
        </div>
        <div className="ais-cache-notes">
          <p>history row 에 연결된 ref 는 절대 삭제하지 않습니다 (안전).</p>
          <p>history 단건/전체 삭제 시 임시 풀도 자동 cascade unlink.</p>
        </div>
      </div>
    </Section>
  );
}
