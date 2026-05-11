import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptFavorite } from "@/lib/api/types";

const api = vi.hoisted(() => ({
  listPromptFavorites: vi.fn(),
  createPromptFavorite: vi.fn(),
  deletePromptFavorite: vi.fn(),
}));

vi.mock("@/lib/api/prompt-favorites", () => api);

import {
  promptFavoriteKey,
  usePromptFavoritesStore,
} from "@/stores/usePromptFavoritesStore";

function fav(input: Partial<PromptFavorite> & Pick<PromptFavorite, "id" | "mode" | "prompt">): PromptFavorite {
  return {
    promptHash: `hash-${input.id}`,
    createdAt: 1000,
    updatedAt: 1000,
    ...input,
  };
}

describe("usePromptFavoritesStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptFavoritesStore.setState({
      entries: [],
      hydrated: false,
      loading: false,
    });
  });

  it("hydrate — 서버 즐겨찾기를 store 에 적재", async () => {
    const item = fav({ id: "fav-1", mode: "generate", prompt: "cat" });
    api.listPromptFavorites.mockResolvedValueOnce([item]);

    await usePromptFavoritesStore.getState().hydrate();

    expect(api.listPromptFavorites).toHaveBeenCalledTimes(1);
    expect(usePromptFavoritesStore.getState().entries).toEqual([item]);
    expect(usePromptFavoritesStore.getState().hydrated).toBe(true);
  });

  it("toggle — 없으면 생성하고 있으면 삭제", async () => {
    const item = fav({ id: "fav-1", mode: "edit", prompt: "change hair" });
    api.createPromptFavorite.mockResolvedValueOnce(item);
    api.deletePromptFavorite.mockResolvedValueOnce(true);

    const afterCreate = await usePromptFavoritesStore
      .getState()
      .toggle("edit", " change hair ");
    expect(afterCreate).toBe(true);
    expect(api.createPromptFavorite).toHaveBeenCalledWith({
      mode: "edit",
      prompt: "change hair",
    });
    expect(usePromptFavoritesStore.getState().entries).toEqual([item]);

    const afterDelete = await usePromptFavoritesStore
      .getState()
      .toggle("edit", "change hair");
    expect(afterDelete).toBe(false);
    expect(api.deletePromptFavorite).toHaveBeenCalledWith("fav-1");
    expect(usePromptFavoritesStore.getState().entries).toEqual([]);
  });

  it("promptFavoriteKey — mode 와 trim 된 prompt 로 매칭", () => {
    expect(promptFavoriteKey("video", " camera push ")).toBe(
      promptFavoriteKey("video", "camera push"),
    );
    expect(promptFavoriteKey("generate", "camera push")).not.toBe(
      promptFavoriteKey("edit", "camera push"),
    );
  });
});
