/**
 * video-auto-nsfw-card — spec 2026-05-12 v1.1 §6.4
 *
 * 카드 단위 테스트. Codex Finding 11 — adult prop 없음 (호출자 책임).
 * "adult OFF 미렌더" 는 VideoLeftPanel integration 에서 검증.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import VideoAutoNsfwCard from "@/components/studio/video/VideoAutoNsfwCard";

describe("VideoAutoNsfwCard (spec 2026-05-12 v1.1)", () => {
  it("토글 OFF 일 때 슬라이더 미렌더", () => {
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={false}
        nsfwIntensity={2}
        onToggle={vi.fn()}
        onIntensityChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("토글 ON 일 때 슬라이더 노출", () => {
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={true}
        nsfwIntensity={2}
        onToggle={vi.fn()}
        onIntensityChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("slider")).toBeInTheDocument();
    // 강도 라벨도 확인 — 디폴트 2 = "옷벗음" (라벨 + 슬라이더 marker 등 N 곳)
    expect(screen.getAllByText(/옷벗음/).length).toBeGreaterThan(0);
  });

  it("토글 클릭 → onToggle 콜백 (true)", () => {
    const onToggle = vi.fn();
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={false}
        nsfwIntensity={2}
        onToggle={onToggle}
        onIntensityChange={vi.fn()}
      />,
    );
    // Toggle 컴포넌트 안 단일 checkbox — getByRole 으로 직접 찾기
    const toggleInput = screen.getByRole("checkbox");
    fireEvent.click(toggleInput);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("슬라이더 변경 → onIntensityChange(3) 콜백", () => {
    const onIntensityChange = vi.fn();
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={true}
        nsfwIntensity={2}
        onToggle={vi.fn()}
        onIntensityChange={onIntensityChange}
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "3" } });
    expect(onIntensityChange).toHaveBeenCalledWith(3);
  });
});
