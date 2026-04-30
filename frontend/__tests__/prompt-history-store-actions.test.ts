/**
 * usePromptHistoryStore 의 removeOne / clearMode + id 고유성 회귀 테스트.
 * 2026-04-30 (Phase 1 · Codex v3 — id 충돌 방지 검증 포함).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";

describe("usePromptHistoryStore", () => {
  beforeEach(() => {
    usePromptHistoryStore.getState().clearMode("generate");
    usePromptHistoryStore.getState().clearMode("edit");
    usePromptHistoryStore.getState().clearMode("video");
    usePromptHistoryStore.getState().clearMode("compare");
  });

  it("removeOne — 특정 id 만 제거 + 나머지 보존", () => {
    const { add, removeOne } = usePromptHistoryStore.getState();
    add("generate", "A");
    add("generate", "B");
    add("generate", "C");
    const ids = usePromptHistoryStore.getState().entries.map((e) => e.id);
    expect(ids.length).toBe(3);

    removeOne(ids[1]);
    const after = usePromptHistoryStore.getState().entries;
    expect(after.length).toBe(2);
  });

  it("removeOne — 존재하지 않는 id 는 silent", () => {
    const { add, removeOne } = usePromptHistoryStore.getState();
    add("generate", "x");
    removeOne("non-existent");
    expect(usePromptHistoryStore.getState().entries.length).toBe(1);
  });

  it("clearMode — 해당 mode 만 비움", () => {
    const { add, clearMode } = usePromptHistoryStore.getState();
    add("generate", "g");
    add("edit", "e");
    add("video", "v");
    clearMode("generate");
    const remaining = usePromptHistoryStore.getState().entries;
    expect(remaining.length).toBe(2);
    expect(remaining.map((e) => e.mode).sort()).toEqual(["edit", "video"]);
  });

  it("id 고유성 — 같은 ms 안 연속 add 시에도 id 충돌 없음 (Codex v3)", () => {
    const { add } = usePromptHistoryStore.getState();
    // 빠르게 5번 연속 add — 옛 ${mode}-${Date.now()} 로직은 충돌 가능
    for (let i = 0; i < 5; i++) add("generate", `prompt ${i}`);
    const ids = usePromptHistoryStore.getState().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(5); // 모두 unique
  });
});
