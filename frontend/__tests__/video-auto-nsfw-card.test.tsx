/**
 * video-auto-nsfw-card — spec 2026-05-12 v1.1 §6.4
 *
 * UX 변경 (2026-05-12): 토글+슬라이더 → 4-option segmented (OFF/1단계/2단계/3단계).
 * Codex Finding 11 — adult prop 없음 (호출자 책임).
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import VideoAutoNsfwCard from "@/components/studio/video/VideoAutoNsfwCard";

describe("VideoAutoNsfwCard (spec 2026-05-12 v1.1 · 4-option segmented)", () => {
  it("4 옵션 (OFF / 1단계 / 2단계 / 3단계) 모두 radio 로 렌더", () => {
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={false}
        nsfwIntensity={2}
        onToggle={vi.fn()}
        onIntensityChange={vi.fn()}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "OFF" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "1단계" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2단계" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "3단계" })).toBeInTheDocument();
  });

  it("autoNsfwEnabled=false → OFF 가 aria-checked", () => {
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={false}
        nsfwIntensity={2}
        onToggle={vi.fn()}
        onIntensityChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "OFF" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "2단계" })).toHaveAttribute("aria-checked", "false");
  });

  it("autoNsfwEnabled=true + intensity=3 → 3단계가 aria-checked", () => {
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={true}
        nsfwIntensity={3}
        onToggle={vi.fn()}
        onIntensityChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "3단계" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "OFF" })).toHaveAttribute("aria-checked", "false");
  });

  it("OFF → 2단계 클릭 → onToggle(true) + onIntensityChange(2)", () => {
    const onToggle = vi.fn();
    const onIntensityChange = vi.fn();
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={false}
        nsfwIntensity={1}
        onToggle={onToggle}
        onIntensityChange={onIntensityChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "2단계" }));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onIntensityChange).toHaveBeenCalledWith(2);
  });

  it("3단계 → OFF 클릭 → onToggle(false) (intensity 변경 X)", () => {
    const onToggle = vi.fn();
    const onIntensityChange = vi.fn();
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={true}
        nsfwIntensity={3}
        onToggle={onToggle}
        onIntensityChange={onIntensityChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "OFF" }));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onIntensityChange).not.toHaveBeenCalled();
  });

  it("1단계 → 3단계 클릭 → onIntensityChange(3) (이미 ON 이라 onToggle 무호출)", () => {
    const onToggle = vi.fn();
    const onIntensityChange = vi.fn();
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={true}
        nsfwIntensity={1}
        onToggle={onToggle}
        onIntensityChange={onIntensityChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "3단계" }));
    expect(onIntensityChange).toHaveBeenCalledWith(3);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
