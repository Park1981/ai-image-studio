/**
 * lib/api/history.ts — 서버 영속 히스토리 CRUD.
 * 2026-04-23 Opus S3.
 */

import { STUDIO_BASE, USE_MOCK, normalizeItem } from "./client";
import type { HistoryItem } from "./types";

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
