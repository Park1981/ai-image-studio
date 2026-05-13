/**
 * VideoLeftPanel - 자동 NSFW 통합 테스트 (spec 2026-05-12 v1.1 §4.9 + §6.5).
 *
 * 검증:
 *   1. adult OFF → VideoAutoNsfwCard 미렌더
 *   2. adult ON → 카드 노출
 *   3. autoNsfwEnabled ON → effectiveAutoNsfw 일 때 CTA/입력/AI 카드 가드 동기화
 */

import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, USE_MOCK: false };
});

import VideoLeftPanel from "@/components/studio/video/VideoLeftPanel";
import { useVideoStore } from "@/stores/useVideoStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

function resetStores(): void {
  const v = useVideoStore.getState();
  v.setSource(null);
  v.setPrompt("");
  v.setAdult(false);
  v.setSkipUpgrade(false);
  v.resetPipeline();
  v.setRunning(false);
  useProcessStore.setState({
    ollama: "running",
    comfyui: "running",
  });
  useSettingsStore.setState({
    autoNsfwEnabled: false,
    nsfwIntensity: 2,
  });
}

function renderPanel(onGenerate = vi.fn()) {
  const ref = createRef<HTMLTextAreaElement>();
  render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);
  return { onGenerate };
}

function setSource(prompt = ""): void {
  const v = useVideoStore.getState();
  v.setSource("data:image/png;base64,xx", "test", 832, 480);
  v.setPrompt(prompt);
}

function renderButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Render/i }) as HTMLButtonElement;
}

beforeEach(() => resetStores());
afterEach(() => resetStores());

describe("VideoLeftPanel auto NSFW integration (spec 2026-05-12 v1.1)", () => {
  it("adult OFF → VideoAutoNsfwCard 미렌더", () => {
    renderPanel();
    // 2026-05-12 UX 변경: 헤더 텍스트 제거 → "자동 NSFW 시나리오 강도" radiogroup 으로 검증
    expect(
      screen.queryByRole("radiogroup", { name: /자동 NSFW 시나리오 강도/ }),
    ).toBeNull();
  });

  it("adult ON → VideoAutoNsfwCard (4-segmented) 노출", () => {
    act(() => {
      useVideoStore.getState().setAdult(true);
    });
    renderPanel();
    expect(
      screen.getByRole("radiogroup", { name: /자동 NSFW 시나리오 강도/ }),
    ).toBeInTheDocument();
  });

  it("sourceImage=null 이면 Render CTA disabled", () => {
    renderPanel();
    expect(renderButton().disabled).toBe(true);
  });

  it("adult OFF + 빈 지시 + persisted autoNsfwEnabled=true → Render CTA disabled", () => {
    act(() => {
      setSource("");
      useSettingsStore.setState({ autoNsfwEnabled: true });
    });
    renderPanel();
    expect(renderButton().disabled).toBe(true);
  });

  it("adult OFF + 지시 있음 + ollama stopped → Render CTA enabled", () => {
    act(() => {
      setSource("느린 달리 인");
      useProcessStore.setState({ ollama: "stopped" });
    });
    renderPanel();
    expect(renderButton().disabled).toBe(false);
  });

  it("adult ON + 0단 + 빈 지시 → Render CTA disabled", () => {
    act(() => {
      setSource("");
      useVideoStore.getState().setAdult(true);
      useSettingsStore.setState({ autoNsfwEnabled: false });
    });
    renderPanel();
    expect(renderButton().disabled).toBe(true);
  });

  it("adult ON + 0단 + 지시 있음 → Render CTA enabled", () => {
    act(() => {
      setSource("느린 달리 인");
      useVideoStore.getState().setAdult(true);
      useSettingsStore.setState({ autoNsfwEnabled: false });
    });
    renderPanel();
    expect(renderButton().disabled).toBe(false);
  });

  it("adult ON + 1단 + ollama stopped → Render CTA disabled", () => {
    act(() => {
      setSource("");
      useVideoStore.getState().setAdult(true);
      useSettingsStore.setState({ autoNsfwEnabled: true, nsfwIntensity: 1 });
      useProcessStore.setState({ ollama: "stopped" });
    });
    renderPanel();
    expect(renderButton().disabled).toBe(true);
  });

  it("mock-seed:// source 는 Render CTA disabled", () => {
    act(() => {
      useVideoStore.getState().setSource("mock-seed://image", "mock", 832, 480);
      useVideoStore.getState().setPrompt("느린 달리 인");
    });
    renderPanel();
    expect(renderButton().disabled).toBe(true);
  });

  it("adult ON + 1단 → 입력 경로 잠금 + PromptModeRadio disabled", () => {
    act(() => {
      setSource("내가 입력함");
      useVideoStore.getState().setAdult(true);
      useSettingsStore.setState({ autoNsfwEnabled: true, nsfwIntensity: 1 });
    });
    renderPanel();

    const textarea = screen.getByPlaceholderText(/어떤 움직임/) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(textarea.value).toBe("내가 입력함");
    expect(screen.queryByTitle(/이전 영상 프롬프트/)).toBeNull();
    expect(screen.queryByLabelText("카테고리 카드로 분리")).toBeNull();
    expect(screen.queryByLabelText("프롬프트 비우기")).toBeNull();

    const promptMode = screen.getByRole("radiogroup", { name: /AI 보정 모드/ });
    expect(promptMode).toHaveAttribute("data-disabled", "true");
    for (const button of promptMode.querySelectorAll("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("adult ON + 1단 + skipUpgrade=true → AI 카드 강제 active, 클릭해도 skipUpgrade 유지", () => {
    act(() => {
      setSource("");
      useVideoStore.getState().setAdult(true);
      useVideoStore.getState().setSkipUpgrade(true);
      useSettingsStore.setState({ autoNsfwEnabled: true, nsfwIntensity: 1 });
    });
    renderPanel();

    const promptMode = screen.getByRole("radiogroup", { name: /AI 보정 모드/ });
    const aiCard = promptMode.closest(".ais-toggle-card") as HTMLElement;
    expect(aiCard).toHaveAttribute("data-active", "true");
    fireEvent.click(aiCard);
    expect(useVideoStore.getState().skipUpgrade).toBe(true);
  });

  it("textarea value 는 1단 진입/0단 복귀 후에도 보존", () => {
    act(() => {
      setSource("내가 입력함");
      useVideoStore.getState().setAdult(true);
      useSettingsStore.setState({ autoNsfwEnabled: true, nsfwIntensity: 1 });
    });
    const { rerender } = render(
      <VideoLeftPanel promptTextareaRef={createRef<HTMLTextAreaElement>()} onGenerate={vi.fn()} />,
    );

    let textarea = screen.getByPlaceholderText(/어떤 움직임/) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(textarea.value).toBe("내가 입력함");

    act(() => {
      useSettingsStore.setState({ autoNsfwEnabled: false });
    });
    rerender(
      <VideoLeftPanel promptTextareaRef={createRef<HTMLTextAreaElement>()} onGenerate={vi.fn()} />,
    );

    textarea = screen.getByPlaceholderText(/어떤 움직임/) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    expect(textarea.value).toBe("내가 입력함");
  });
});
