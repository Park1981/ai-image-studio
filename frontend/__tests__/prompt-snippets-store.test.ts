/**
 * usePromptSnippetsStore 단위 테스트 — CRUD + id 고유성 + 마커 sanitize.
 * 2026-04-30 (Phase 2A Task 3 · plan 2026-04-30-prompt-snippets-library.md · v3).
 *
 * 정책:
 *   - dedupe 없음 (사용자 판단)
 *   - id 충돌 방지 — crypto.randomUUID
 *   - 저장 시 prompt 의 기존 <lib>...</lib> 마커 strip (중첩 방지)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { usePromptSnippetsStore } from "@/stores/usePromptSnippetsStore";

describe("usePromptSnippetsStore", () => {
  beforeEach(() => {
    usePromptSnippetsStore.getState().clearAll();
  });

  it("add — 새 항목 entries 맨 앞 + id/createdAt 자동", () => {
    const { add } = usePromptSnippetsStore.getState();
    add({ name: "내 얼굴 1", prompt: "delicate korean girl" });
    const e = usePromptSnippetsStore.getState().entries[0];
    expect(e.name).toBe("내 얼굴 1");
    expect(e.prompt).toBe("delicate korean girl");
    expect(e.id).toMatch(/^snip-/);
  });

  it("add — 빈 name/prompt 는 silent skip", () => {
    const { add } = usePromptSnippetsStore.getState();
    add({ name: "", prompt: "x" });
    add({ name: "x", prompt: "" });
    add({ name: "  ", prompt: "valid" });
    expect(usePromptSnippetsStore.getState().entries.length).toBe(0);
  });

  it("add — 중복 prompt 도 두 번 모두 등록 (dedupe 없음 정책)", () => {
    const { add } = usePromptSnippetsStore.getState();
    add({ name: "A", prompt: "same" });
    add({ name: "B", prompt: "same" });
    expect(usePromptSnippetsStore.getState().entries.length).toBe(2);
  });

  it("add — prompt 안 <lib>...</lib> 마커 자동 strip (중첩 방지 · Codex v3)", () => {
    const { add } = usePromptSnippetsStore.getState();
    add({
      name: "마커 포함",
      prompt: "a girl, <lib>cinematic 35mm</lib>, warm light",
    });
    const e = usePromptSnippetsStore.getState().entries[0];
    expect(e.prompt).toBe("a girl, cinematic 35mm, warm light");
    expect(e.prompt).not.toContain("<lib>");
  });

  it("id 고유성 — 같은 ms 연속 add 시 충돌 없음 (Codex v3)", () => {
    const { add } = usePromptSnippetsStore.getState();
    for (let i = 0; i < 5; i++) add({ name: `n${i}`, prompt: `p${i}` });
    const ids = usePromptSnippetsStore.getState().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("remove — 특정 id 만 제거", () => {
    const { add, remove } = usePromptSnippetsStore.getState();
    add({ name: "A", prompt: "a" });
    add({ name: "B", prompt: "b" });
    const ids = usePromptSnippetsStore.getState().entries.map((e) => e.id);
    remove(ids[0]);
    expect(usePromptSnippetsStore.getState().entries.length).toBe(1);
  });

  it("clearAll — 전부 비움", () => {
    const { add, clearAll } = usePromptSnippetsStore.getState();
    add({ name: "A", prompt: "a" });
    clearAll();
    expect(usePromptSnippetsStore.getState().entries.length).toBe(0);
  });

  // 2026-04-30 (drawer 디자인 + 수정 기능) — update 액션 회귀
  it("update — name 만 변경 (prompt/thumbnail 보존)", () => {
    const { add, update } = usePromptSnippetsStore.getState();
    add({ name: "Old", prompt: "p", thumbnail: "data:image/webp;base64,xx" });
    const id = usePromptSnippetsStore.getState().entries[0].id;
    update(id, { name: "New" });
    const e = usePromptSnippetsStore.getState().entries[0];
    expect(e.name).toBe("New");
    expect(e.prompt).toBe("p");
    expect(e.thumbnail).toBe("data:image/webp;base64,xx");
  });

  it("update — prompt 의 <lib> 마커 자동 strip (sanitize)", () => {
    const { add, update } = usePromptSnippetsStore.getState();
    add({ name: "n", prompt: "old prompt" });
    const id = usePromptSnippetsStore.getState().entries[0].id;
    update(id, { prompt: "new, <lib>cinematic 35mm</lib>, warm" });
    expect(usePromptSnippetsStore.getState().entries[0].prompt).toBe(
      "new, cinematic 35mm, warm",
    );
  });

  it("update — thumbnail undefined 명시 시 제거", () => {
    const { add, update } = usePromptSnippetsStore.getState();
    add({ name: "n", prompt: "p", thumbnail: "data:image/webp;base64,xx" });
    const id = usePromptSnippetsStore.getState().entries[0].id;
    update(id, { thumbnail: undefined });
    expect(usePromptSnippetsStore.getState().entries[0].thumbnail).toBeUndefined();
  });

  it("update — 존재하지 않는 id 는 silent", () => {
    const { add, update } = usePromptSnippetsStore.getState();
    add({ name: "n", prompt: "p" });
    update("non-existent", { name: "x" });
    expect(usePromptSnippetsStore.getState().entries[0].name).toBe("n");
  });

  it("update — 빈 name / sanitize 후 빈 prompt 는 silent skip", () => {
    const { add, update } = usePromptSnippetsStore.getState();
    add({ name: "Original", prompt: "Original" });
    const id = usePromptSnippetsStore.getState().entries[0].id;
    update(id, { name: "  " });
    update(id, { prompt: "<lib></lib>" });
    expect(usePromptSnippetsStore.getState().entries[0].name).toBe("Original");
    expect(usePromptSnippetsStore.getState().entries[0].prompt).toBe("Original");
  });
});
