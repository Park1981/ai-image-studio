/**
 * VideoLeftPanel - 자동 NSFW 통합 테스트 (spec 2026-05-12 v1.1 §4.9 + §6.5).
 *
 * 검증:
 *   1. adult OFF → VideoAutoNsfwCard 미렌더
 *   2. adult ON → 카드 노출
 *   3. autoNsfwEnabled ON → skipUpgrade 토글이 시각적으로 disabled (Toggle disabled prop)
 */

import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import VideoLeftPanel from "@/components/studio/video/VideoLeftPanel";
import { useVideoStore } from "@/stores/useVideoStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

function resetStores(): void {
  const v = useVideoStore.getState();
  v.setSource(null);
  v.setPrompt("");
  v.setAdult(false);
  v.setSkipUpgrade(false);
  v.resetPipeline();
  v.setRunning(false);
  useSettingsStore.setState({
    autoNsfwEnabled: false,
    nsfwIntensity: 2,
  });
}

beforeEach(() => resetStores());
afterEach(() => resetStores());

describe("VideoLeftPanel auto NSFW integration (spec 2026-05-12 v1.1)", () => {
  it("adult OFF → VideoAutoNsfwCard 미렌더", () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <VideoLeftPanel promptTextareaRef={ref} onGenerate={vi.fn()} />,
    );
    // 2026-05-12 UX 변경: 헤더 텍스트 제거 → "자동 NSFW 시나리오 강도" radiogroup 으로 검증
    expect(
      screen.queryByRole("radiogroup", { name: /자동 NSFW 시나리오 강도/ }),
    ).toBeNull();
  });

  it("adult ON → VideoAutoNsfwCard (4-segmented) 노출", () => {
    const ref = createRef<HTMLTextAreaElement>();
    act(() => {
      useVideoStore.getState().setAdult(true);
    });
    render(
      <VideoLeftPanel promptTextareaRef={ref} onGenerate={vi.fn()} />,
    );
    expect(
      screen.getByRole("radiogroup", { name: /자동 NSFW 시나리오 강도/ }),
    ).toBeInTheDocument();
  });

  it("autoNsfwEnabled ON → AI 프롬프트 보정 시각적 ON 강제 + PromptModeRadio 노출", () => {
    const ref = createRef<HTMLTextAreaElement>();
    act(() => {
      useVideoStore.getState().setAdult(true);
      useVideoStore.getState().setSkipUpgrade(true); // 사용자가 OFF 였어도
      useSettingsStore.setState({ autoNsfwEnabled: true });
    });
    render(
      <VideoLeftPanel promptTextareaRef={ref} onGenerate={vi.fn()} />,
    );
    // V5MotionCard 의 AI 프롬프트 보정 토글 (flat=true · input 없음)
    // 의 checked 가 autoNsfwEnabled 때문에 시각적으로 ON (`!skipUpgrade || autoNsfwEnabled`)
    // → PromptModeRadio 노출되는 분기 활성화 검증 (radiogroup role 존재)
    expect(
      screen.getByRole("radiogroup", { name: /AI 보정 모드/ }),
    ).toBeInTheDocument();
  });
});
