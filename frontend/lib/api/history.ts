/**
 * lib/api/history.ts — 서버 영속 히스토리 CRUD.
 * 2026-04-23 Opus S3.
 */

import { STUDIO_BASE, USE_MOCK, normalizeItem } from "./client";
import type { HistoryItem, HistoryStats } from "./types";

export async function listHistory(opts?: {
  mode?: "generate" | "edit" | "video";
  limit?: number;
  before?: number;
}): Promise<{ items: HistoryItem[]; total: number }> {
  if (USE_MOCK) {
    return { items: [], total: 0 };
  }
  const q = new URLSearchParams();
  if (opts?.mode) q.set("mode", opts.mode);
  if (opts?.limit) q.set("limit", String(opts.limit));
  if (opts?.before) q.set("before", String(opts.before));
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/history?${q.toString()}`,
  );
  if (!res.ok) throw new Error(`history list failed: ${res.status}`);
  const data = (await res.json()) as {
    items: HistoryItem[];
    total: number;
  };
  return { items: data.items.map(normalizeItem), total: data.total };
}

export async function deleteHistoryItem(id: string): Promise<void> {
  if (USE_MOCK) return;
  const res = await fetch(`${STUDIO_BASE}/api/studio/history/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404)
    throw new Error(`delete failed: ${res.status}`);
}

export async function clearHistory(): Promise<number> {
  if (USE_MOCK) return 0;
  const res = await fetch(`${STUDIO_BASE}/api/studio/history`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`clear failed: ${res.status}`);
  const data = (await res.json()) as { deleted: number };
  return data.deleted;
}

/** 히스토리 통계 — 갯수/디스크 사용량/모드별 (2026-04-27).
 *  설정 드로어의 HistoryStats 카드 + 백그라운드 폴링 등에서 사용. */
export async function getHistoryStats(): Promise<HistoryStats | null> {
  if (USE_MOCK) {
    // mock 모드는 기본값 0 — 카드 노출은 되지만 빈 상태.
    return {
      count: 0,
      totalSizeBytes: 0,
      dbSizeBytes: 0,
      byMode: {
        generate: { count: 0, sizeBytes: 0 },
        edit: { count: 0, sizeBytes: 0 },
        video: { count: 0, sizeBytes: 0 },
      },
    };
  }
  try {
    const res = await fetch(`${STUDIO_BASE}/api/studio/history/stats`);
    if (!res.ok) throw new Error(`stats failed: ${res.status}`);
    const raw = (await res.json()) as {
      count: number;
      total_size_bytes: number;
      db_size_bytes: number;
      by_mode: Record<string, { count: number; size_bytes: number }>;
    };
    return {
      count: raw.count,
      totalSizeBytes: raw.total_size_bytes,
      dbSizeBytes: raw.db_size_bytes,
      byMode: {
        generate: {
          count: raw.by_mode.generate?.count ?? 0,
          sizeBytes: raw.by_mode.generate?.size_bytes ?? 0,
        },
        edit: {
          count: raw.by_mode.edit?.count ?? 0,
          sizeBytes: raw.by_mode.edit?.size_bytes ?? 0,
        },
        video: {
          count: raw.by_mode.video?.count ?? 0,
          sizeBytes: raw.by_mode.video?.size_bytes ?? 0,
        },
      },
    };
  } catch {
    return null;
  }
}
