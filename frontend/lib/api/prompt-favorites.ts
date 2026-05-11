/**
 * lib/api/prompt-favorites.ts — PromptHistoryPeek 별 즐겨찾기 API.
 *
 * 저장 대상은 사용자가 입력한 원문 prompt 이며, AI 보강 후 실행 prompt 는
 * 생성 결과 history 의 upgradedPrompt 로만 유지한다.
 */

import { STUDIO_BASE, USE_MOCK, uid } from "./client";
import type { PromptFavorite, PromptFavoriteMode } from "./types";

export async function listPromptFavorites(opts?: {
  mode?: PromptFavoriteMode;
}): Promise<PromptFavorite[]> {
  if (USE_MOCK) return [];
  const q = new URLSearchParams();
  if (opts?.mode) q.set("mode", opts.mode);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const res = await fetch(`${STUDIO_BASE}/api/studio/prompt-favorites${suffix}`);
  if (!res.ok) throw new Error(`prompt favorites list failed: ${res.status}`);
  const data = (await res.json()) as { items: PromptFavorite[] };
  return data.items ?? [];
}

export async function createPromptFavorite(input: {
  mode: PromptFavoriteMode;
  prompt: string;
}): Promise<PromptFavorite> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("prompt required");

  if (USE_MOCK) {
    const now = Date.now();
    return {
      id: uid("fav"),
      mode: input.mode,
      prompt,
      promptHash: `mock-${now}`,
      createdAt: now,
      updatedAt: now,
    };
  }

  const res = await fetch(`${STUDIO_BASE}/api/studio/prompt-favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: input.mode, prompt }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`prompt favorite create failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { item: PromptFavorite };
  return data.item;
}

export async function deletePromptFavorite(id: string): Promise<boolean> {
  if (USE_MOCK) return true;
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/prompt-favorites/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`prompt favorite delete failed: ${res.status}`);
  return true;
}
