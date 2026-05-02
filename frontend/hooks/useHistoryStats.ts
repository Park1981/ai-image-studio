/**
 * useHistoryStats — 백엔드 `/api/studio/history/stats` 응답을 가져오고
 * 히스토리 변경 시 자동 refetch 하는 훅.
 *
 * 2026-05-02 디자인 V5 Phase 4 — Generate/Edit/Video 우측 Archive Header 의
 * size chip (`248 MB`) 표시에 사용. 모드별 sizeBytes/count 분리.
 *
 * 정책:
 *  - 마운트 시 1회 fetch
 *  - `useHistoryStore.items.length` 변화 시 refetch (debounce 800ms — add/delete burst 압축)
 *  - fetch 실패 시 stats=null 유지 (이전 값 보존 X — UI 가 size chip 자동 미노출)
 *  - mock 모드는 0 으로 채워진 stats 반환 (settings/HistorySection 과 동일 패턴)
 */

"use client";

import { useEffect, useState } from "react";
import { getHistoryStats } from "@/lib/api/history";
import type { HistoryStats } from "@/lib/api/types";
import { useHistoryStore } from "@/stores/useHistoryStore";

const REFETCH_DEBOUNCE_MS = 800;

export function useHistoryStats(): HistoryStats | null {
  const itemsLength = useHistoryStore((s) => s.items.length);
  const [stats, setStats] = useState<HistoryStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const next = await getHistoryStats();
        if (!cancelled) setStats(next);
      })();
    }, REFETCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [itemsLength]);

  return stats;
}
