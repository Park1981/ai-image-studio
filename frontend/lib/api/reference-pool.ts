/**
 * lib/api/reference-pool.ts — Edit reference 임시 풀 통계 / cleanup API.
 *
 * v9 (2026-04-29 · Phase D.1): 설정 Drawer 의 "참조 임시 캐시" 섹션이 사용.
 *
 * 백엔드 라우트: /api/studio/reference-pool/{stats|orphans}
 */

import { STUDIO_BASE, USE_MOCK } from "./client";

export interface PoolStats {
  count: number;
  totalBytes: number;
}

export interface OrphansList {
  refs: string[];
  count: number;
}

export interface DeleteOrphansResult {
  deleted: number;
  totalOrphans: number;
}

export async function getPoolStats(): Promise<PoolStats> {
  if (USE_MOCK) return { count: 0, totalBytes: 0 };
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-pool/stats`);
  if (!res.ok) {
    throw new Error(`pool stats failed: ${res.status}`);
  }
  return (await res.json()) as PoolStats;
}

export async function getPoolOrphans(): Promise<OrphansList> {
  if (USE_MOCK) return { refs: [], count: 0 };
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-pool/orphans`);
  if (!res.ok) {
    throw new Error(`pool orphans failed: ${res.status}`);
  }
  return (await res.json()) as OrphansList;
}

export async function deletePoolOrphans(): Promise<DeleteOrphansResult> {
  if (USE_MOCK) return { deleted: 0, totalOrphans: 0 };
  const res = await fetch(`${STUDIO_BASE}/api/studio/reference-pool/orphans`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`pool delete orphans failed: ${res.status}`);
  }
  return (await res.json()) as DeleteOrphansResult;
}
