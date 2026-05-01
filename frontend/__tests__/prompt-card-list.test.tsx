/**
 * Phase 5 후속 (Codex 리뷰 fix) — PromptCardList 동작 검증.
 *
 * - sections prop 변경 시 selected/deleted reset (Medium fix)
 * - 기본 미선택 (Low fix)
 * - [선택 추가] (Append) vs [원본 교체] (Replace) 액션 분리 (Low fix)
 */

import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import PromptCardList from "@/components/studio/prompt-tools/PromptCardList";
import type { PromptSection } from "@/lib/api/prompt-tools";

afterEach(() => cleanup());

const sectionsA: PromptSection[] = [
  { key: "subject", text: "young woman" },
  { key: "outfit", text: "red dress" },
];

const sectionsB: PromptSection[] = [
  { key: "lighting", text: "sunset glow" },
  { key: "style", text: "cinematic grading" },
  { key: "background", text: "city skyline" },
];

it("기본 모든 카드 *미선택* — Append/Replace 버튼 disabled", () => {
  render(
    <PromptCardList
      sections={sectionsA}
      onAppend={vi.fn()}
      onReplace={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  // 모든 체크박스가 unchecked
  const checkboxes = screen.getAllByRole("checkbox");
  expect(checkboxes).toHaveLength(2);
  for (const cb of checkboxes) {
    expect((cb as HTMLInputElement).checked).toBe(false);
  }

  // 버튼은 disabled
  const appendBtn = screen.getByRole("button", { name: /선택 추가/ });
  const replaceBtn = screen.getByRole("button", { name: /원본 교체/ });
  expect((appendBtn as HTMLButtonElement).disabled).toBe(true);
  expect((replaceBtn as HTMLButtonElement).disabled).toBe(true);
});

it("선택 후 [선택 추가] 누르면 onAppend(texts) 호출", () => {
  const onAppend = vi.fn();
  render(
    <PromptCardList
      sections={sectionsA}
      onAppend={onAppend}
      onReplace={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  // 첫 카드만 선택
  const checkboxes = screen.getAllByRole("checkbox");
  fireEvent.click(checkboxes[0]);

  fireEvent.click(screen.getByRole("button", { name: /선택 추가/ }));
  expect(onAppend).toHaveBeenCalledWith(["young woman"]);
});

it("선택 후 [원본 교체] 누르면 onReplace(texts) 호출", () => {
  const onReplace = vi.fn();
  render(
    <PromptCardList
      sections={sectionsA}
      onAppend={vi.fn()}
      onReplace={onReplace}
      onClose={vi.fn()}
    />,
  );

  const checkboxes = screen.getAllByRole("checkbox");
  fireEvent.click(checkboxes[0]);
  fireEvent.click(checkboxes[1]);

  fireEvent.click(screen.getByRole("button", { name: /원본 교체/ }));
  expect(onReplace).toHaveBeenCalledWith(["young woman", "red dress"]);
});

it("sections prop 변경 시 selected/deleted state reset (Codex Medium fix)", () => {
  const { rerender } = render(
    <PromptCardList
      sections={sectionsA}
      onAppend={vi.fn()}
      onReplace={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  // sectionsA 의 첫 카드 선택 + 둘째 삭제
  const checkboxesA = screen.getAllByRole("checkbox");
  fireEvent.click(checkboxesA[0]);
  fireEvent.click(screen.getAllByRole("button", { name: /삭제/ })[1]);

  // sectionsB 로 갱신
  rerender(
    <PromptCardList
      sections={sectionsB}
      onAppend={vi.fn()}
      onReplace={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  // 새 sections 의 모든 카드가 visible (이전 deleted idx 가 새 카드 숨기지 않음)
  const checkboxesB = screen.getAllByRole("checkbox");
  expect(checkboxesB).toHaveLength(3);
  // 모두 unchecked (이전 selected 가 잔존하지 않음)
  for (const cb of checkboxesB) {
    expect((cb as HTMLInputElement).checked).toBe(false);
  }
});
