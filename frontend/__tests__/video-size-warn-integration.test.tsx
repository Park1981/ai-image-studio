/**
 * VideoLeftPanel - 큰 사이즈 경고 모달 CTA 분기 통합 테스트.
 * spec: §6.1.4
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import VideoLeftPanel from "@/components/studio/video/VideoLeftPanel";
import { useVideoStore } from "@/stores/useVideoStore";

/** 테스트마다 useVideoStore 초기화. */
function resetStore(): void {
  const s = useVideoStore.getState();
  // 입력 reset
  s.setSource(null);
  s.setPrompt("");
  s.setLongerEdge(832);
  s.setLightning(true);
  s.setAdult(false);
  s.setSkipUpgrade(false);
  // 실행 상태 reset
  s.resetPipeline();
  s.setRunning(false);
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

/** 임계 미만 (832×480) source 세팅. */
function setSmallSource(): void {
  useVideoStore.getState().setSource("data:image/png;base64,xx", "test", 832, 480);
  useVideoStore.getState().setPrompt("느린 달리 인");
  useVideoStore.getState().setLongerEdge(832);
}

/** 임계 충족 (1536×864) source 세팅. */
function setLargeSource(): void {
  useVideoStore.getState().setSource("data:image/png;base64,xx", "test", 1920, 1080);
  useVideoStore.getState().setPrompt("느린 달리 인");
  useVideoStore.getState().setLongerEdge(1536);
}

describe("VideoLeftPanel CTA 분기", () => {
  it("임계 미만 사이즈 + Render 클릭 → onGenerate 즉시 호출, 모달 미노출", () => {
    setSmallSource();
    const onGenerate = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("임계 충족 사이즈 + Render 클릭 → 모달 노출, onGenerate 미호출", () => {
    setLargeSource();
    const onGenerate = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("큰 사이즈로 생성할까요?")).toBeTruthy();
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("모달 [그대로 진행] → 모달 닫힘 + onGenerate 호출", () => {
    setLargeSource();
    const onGenerate = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));
    fireEvent.click(screen.getByText("그대로 진행"));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("모달 [취소] → 모달 닫힘 + onGenerate 미호출", () => {
    setLargeSource();
    const onGenerate = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));
    fireEvent.click(screen.getByText("취소"));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("slider 와 모달이 같은 expected 표시 (단일 진실원)", () => {
    setLargeSource();
    const ref = createRef<HTMLTextAreaElement>();
    render(<VideoLeftPanel promptTextareaRef={ref} onGenerate={vi.fn()} />);

    // slider chip (.ais-size-header-chip) 에서 출력 사이즈 확인
    // getAllByText 로 여러 × 포함 요소 중 1536×864 포함된 것 찾기
    const allCrossTexts = screen.getAllByText(/×/);
    const chipEl = allCrossTexts.find((el) =>
      el.textContent?.includes("1536×864")
    );
    expect(chipEl).toBeTruthy();
    const sliderText = chipEl?.textContent ?? "";

    fireEvent.click(screen.getByRole("button", { name: /Render/i }));

    // 모달 본문의 출력 사이즈 표기
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("1536×864");
    expect(sliderText).toContain("1536×864");
  });
});
