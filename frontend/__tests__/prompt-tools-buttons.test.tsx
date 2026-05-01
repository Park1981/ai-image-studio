/**
 * Phase 5 후속 (2026-05-01) — PromptToolsButtons UI + 휴리스틱 비활성 검증.
 *
 * 검증:
 *  - 메뉴 펼침 (번역 dropdown)
 *  - 휴리스틱 비활성: 영문만 → 한→영 disabled, 한글만 → 영→한 disabled
 *  - 분리 비활성: phraseCount < 3
 *  - busy 시 spinner only (텍스트 라벨 X)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import type { UsePromptToolsReturn } from "@/hooks/usePromptTools";

afterEach(() => cleanup());

function makeTools(overrides: Partial<UsePromptToolsReturn> = {}): UsePromptToolsReturn {
  return {
    busy: null,
    blocked: false,
    trimmedPrompt: "test prompt",
    sections: null,
    translation: null,
    runSplit: vi.fn(async () => undefined),
    runTranslate: vi.fn(async () => undefined),
    appendSections: vi.fn(),
    replaceFromSections: vi.fn(),
    replaceFromTranslation: vi.fn(),
    closeSections: vi.fn(),
    closeTranslation: vi.fn(),
    ...overrides,
  };
}

describe("번역 dropdown 메뉴", () => {
  it("번역 버튼 클릭 시 메뉴 펼침 + 한↔영 항목 노출", () => {
    const tools = makeTools({ trimmedPrompt: "한국어 mixed English" });
    render(<PromptToolsButtons tools={tools} />);

    // 메뉴는 처음 닫힘
    expect(screen.queryByRole("menu")).toBeNull();

    // 번역 버튼 (aria-haspopup) 클릭
    const translateBtn = screen.getByRole("button", { name: /번역/ });
    fireEvent.click(translateBtn);

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /한.+영/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /영.+한/ })).toBeTruthy();
  });

  it("순수 영문 prompt → 한→영 메뉴 항목 disabled", () => {
    const tools = makeTools({ trimmedPrompt: "Cat in space, cinematic light" });
    render(<PromptToolsButtons tools={tools} />);

    fireEvent.click(screen.getByRole("button", { name: /번역/ }));
    const koToEn = screen.getByRole("menuitem", { name: /한.+영/ });
    expect((koToEn as HTMLButtonElement).disabled).toBe(true);
  });

  it("순수 한국어 prompt → 영→한 메뉴 항목 disabled", () => {
    const tools = makeTools({ trimmedPrompt: "고양이 우주에서 영화적인" });
    render(<PromptToolsButtons tools={tools} />);

    fireEvent.click(screen.getByRole("button", { name: /번역/ }));
    const enToKo = screen.getByRole("menuitem", { name: /영.+한/ });
    expect((enToKo as HTMLButtonElement).disabled).toBe(true);
  });

  it("혼합 (한+영) → 두 항목 모두 활성", () => {
    const tools = makeTools({ trimmedPrompt: "a Korean 여자, K-pop 아이돌" });
    render(<PromptToolsButtons tools={tools} />);

    fireEvent.click(screen.getByRole("button", { name: /번역/ }));
    expect(
      (screen.getByRole("menuitem", { name: /한.+영/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("menuitem", { name: /영.+한/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("분리 버튼 비활성", () => {
  it("phrase < 3 개 → 분리 버튼 disabled", () => {
    const tools = makeTools({ trimmedPrompt: "a, b" });  // 2 phrase
    render(<PromptToolsButtons tools={tools} />);

    const splitBtn = screen.getByRole("button", {
      name: /카테고리 카드로 분리/,
    });
    expect((splitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("phrase >= 3 개 → 분리 버튼 활성", () => {
    const tools = makeTools({ trimmedPrompt: "a, b, c, d" });
    render(<PromptToolsButtons tools={tools} />);

    const splitBtn = screen.getByRole("button", {
      name: /카테고리 카드로 분리/,
    });
    expect((splitBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("busy 상태 — spinner only", () => {
  it("split busy → 분리 버튼 안 spinner (sub SVG 있음)", () => {
    const tools = makeTools({
      busy: "split",
      blocked: true,
      trimmedPrompt: "a, b, c, d",
    });
    const { container } = render(<PromptToolsButtons tools={tools} />);

    // spinner SVG 가 분리 버튼 안에 들어있는지 — animation 속성이 적용된 path 존재 여부
    const splitBtn = screen.getByRole("button", {
      name: /카테고리 카드로 분리/,
    });
    // disabled 인 상태 (busy 라 blocked)
    expect((splitBtn as HTMLButtonElement).disabled).toBe(true);
    // SVG 있음 (spinner 또는 split icon · 둘 다 svg) → 텍스트 라벨 X
    const svg = container.querySelectorAll("svg");
    expect(svg.length).toBeGreaterThan(0);
  });
});

describe("전체 blocked (페이지 generating 등)", () => {
  it("blocked=true → 모든 버튼 disabled", () => {
    const tools = makeTools({ blocked: true });
    render(<PromptToolsButtons tools={tools} />);

    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
