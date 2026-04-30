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
    <Section title="참조 임시 캐시" desc="Edit 사용자 직접 업로드 reference 의 임시 풀">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          className="mono"
          style={{ fontSize: 12, color: "var(--ink-2)" }}
        >
          {loading
            ? "로딩 중…"
            : stats
              ? `총 ${stats.count}개 · ${mb} MB`
              : "—"}
        </div>
        <div
          style={{ fontSize: 11.5, color: "var(--ink-3)" }}
        >
          history 에서 참조 끊긴 고아 참조:{" "}
          <strong style={{ color: orphanCount > 0 ? "var(--warn, #c08400)" : "var(--ink-3)" }}>
            {orphanCount}개
          </strong>
        </div>
        <button
          type="button"
          onClick={() => void handleDeleteOrphans()}
          disabled={busy || orphanCount === 0}
          style={{
            all: "unset",
            cursor: busy || orphanCount === 0 ? "not-allowed" : "pointer",
            padding: "8px 12px",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            fontWeight: 500,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color:
              orphanCount > 0
                ? "var(--danger, #c44)"
                : "var(--ink-4, #999)",
            opacity: busy || orphanCount === 0 ? 0.5 : 1,
            textAlign: "center",
          }}
        >
          {busy ? "삭제 중…" : `고아 참조 ${orphanCount}개 일괄 삭제`}
        </button>
        <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
          ※ history row 에 연결된 ref 는 절대 삭제하지 않습니다 (안전).
          <br />※ history 단건/전체 삭제 시 임시 풀도 자동 cascade unlink.
        </div>
      </div>
    </Section>
  );
}
