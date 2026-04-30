/**
 * usePromptSnippetsStore — 사용자 큐레이션 prompt 라이브러리.
 *
 * 2026-04-30 (Phase 2A Task 3 · plan 2026-04-30-prompt-snippets-library.md · v3).
 *
 * 정책:
 *   - 카테고리 X (라벨 자체가 카테고리 역할)
 *   - 썸네일 옵셔널 (data URL · 사용자가 crop 한 영역)
 *   - dedupe 없음 (사용자 판단)
 *   - id = crypto.randomUUID (Codex v3 #1 — 같은-ms 충돌 방지)
 *   - 저장 시 prompt 의 기존 <lib>...</lib> 마커 strip (중첩 방지 · Codex v3 #4)
 *   - localStorage persist · 80개 자동 제한
 */

"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { stripAllMarkers } from "@/lib/snippet-marker";

export interface PromptSnippet {
  id: string;
  name: string;
  prompt: string;
  thumbnail?: string;
  createdAt: number;
}

interface SnippetState {
  entries: PromptSnippet[];
  add: (input: { name: string; prompt: string; thumbnail?: string }) => void;
  /**
   * 2026-04-30 (drawer 디자인 + 수정 기능):
   * 부분 업데이트 — undefined 인 필드는 변경 X.
   * thumbnail 은 명시적 undefined 로 제거 가능.
   * sanitize: prompt 는 stripAllMarkers + trim, name 은 trim.
   * 빈 name / 빈 prompt 로 덮어쓰면 silent skip.
   */
  update: (
    id: string,
    partial: { name?: string; prompt?: string; thumbnail?: string },
  ) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  /**
   * 2026-04-30 (localStorage quota 후속 fix):
   * 옛 PNG dataURL 썸네일을 WebP 256px 로 압축. idempotent —
   * 이미 WebP 면 skip. 실패한 항목은 원본 유지 (안전).
   */
  migrateLargeThumbnails: () => Promise<void>;
}

const MAX_SNIPPETS = 80;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `snip-${crypto.randomUUID()}`;
  }
  return `snip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const usePromptSnippetsStore = create<SnippetState>()(
  persist(
    (set, get) => ({
      entries: [],
      add: ({ name, prompt, thumbnail }) => {
        const cleanName = name.trim();
        // Codex v3 #4: 저장 시 기존 <lib>...</lib> 마커 strip — 중첩 방지.
        const cleanPrompt = stripAllMarkers(prompt).trim();
        if (!cleanName || !cleanPrompt) return;
        set((s) => ({
          entries: [
            {
              id: makeId(),
              name: cleanName,
              prompt: cleanPrompt,
              thumbnail,
              createdAt: Date.now(),
            },
            ...s.entries,
          ].slice(0, MAX_SNIPPETS),
        }));
      },
      update: (id, partial) => {
        set((s) => {
          const idx = s.entries.findIndex((e) => e.id === id);
          if (idx < 0) return s;
          const next = { ...s.entries[idx] };
          if (partial.name !== undefined) {
            const cleanName = partial.name.trim();
            if (!cleanName) return s;
            next.name = cleanName;
          }
          if (partial.prompt !== undefined) {
            const cleanPrompt = stripAllMarkers(partial.prompt).trim();
            if (!cleanPrompt) return s;
            next.prompt = cleanPrompt;
          }
          if ("thumbnail" in partial) {
            next.thumbnail = partial.thumbnail;
          }
          const updated = [...s.entries];
          updated[idx] = next;
          return { entries: updated };
        });
      },
      remove: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      clearAll: () => set({ entries: [] }),
      migrateLargeThumbnails: async () => {
        // 2026-04-30 후속 fix — 옛 PNG dataURL 썸네일 → WebP 256px 압축.
        // idempotent: 이미 WebP 면 skip. 실패한 항목은 원본 유지 (사용자 데이터 손실 방지).
        // dynamic import 로 image-crop (canvas/Image 의존) lazy 로딩 — store init 시 X.
        const before = get().entries;
        if (before.length === 0) return;

        const { compressDataUrlToWebp } = await import("@/lib/image-crop");
        const updated: PromptSnippet[] = [];
        let changed = 0;

        for (const e of before) {
          if (!e.thumbnail || e.thumbnail.startsWith("data:image/webp")) {
            updated.push(e);
            continue;
          }
          try {
            const next = await compressDataUrlToWebp(e.thumbnail);
            updated.push({ ...e, thumbnail: next });
            changed += 1;
          } catch (err) {
            console.warn("[snippets] 썸네일 마이그레이션 실패:", e.id, err);
            updated.push(e);
          }
        }

        if (changed > 0) {
          set({ entries: updated });
          console.log(
            `[snippets] 썸네일 ${changed}/${before.length}개 WebP 마이그레이션 완료`,
          );
        }
      },
    }),
    {
      name: "ais:prompt-snippets",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
