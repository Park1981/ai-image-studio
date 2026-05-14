/**
 * ToggleRow — 설정 드로어 공용 토글 카드 테스트 (2026-05-14).
 *
 * 검증:
 *  - switch variant: checked / onChange + role="switch" + aria-checked
 *  - segmented variant: value / onChange + role="radiogroup" + radio buttons
 *  - tone="violet" data attribute 적용
 *  - marker 옵션 (미지정 시 marker DOM 없음)
 *  - 회귀 가드: segmented 버튼이 white-space: nowrap + min-width 강제 적용 클래스
 *    (CSS 자체는 jsdom 에서 computed 안되니까 className 만 확인)
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToggleRow } from "@/components/settings/ToggleRow";

describe("ToggleRow · switch variant", () => {
  it("checked=true 일 때 switch 의 aria-checked='true' + 카드 is-active", () => {
    const { container } = render(
      <ToggleRow
        label="프롬프트 숨기기"
        control={{ variant: "switch", checked: true, onChange: vi.fn() }}
      />,
    );
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.classList.contains("is-on")).toBe(true);
    const row = container.querySelector(".ais-toggle-row");
    expect(row?.classList.contains("is-active")).toBe(true);
  });

  it("checked=false 일 때 카드 is-active 미적용", () => {
    const { container } = render(
      <ToggleRow
        label="프롬프트 숨기기"
        control={{ variant: "switch", checked: false, onChange: vi.fn() }}
      />,
    );
    const row = container.querySelector(".ais-toggle-row");
    expect(row?.classList.contains("is-active")).toBe(false);
  });

  it("switch 클릭 시 onChange(반전값) 호출", () => {
    const onChange = vi.fn();
    render(
      <ToggleRow
        label="프롬프트 숨기기"
        control={{ variant: "switch", checked: false, onChange }}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("ToggleRow · segmented variant", () => {
  it("radiogroup + 각 옵션 radio buttons 렌더", () => {
    render(
      <ToggleRow
        label="AI 보정 모드 기본값"
        control={{
          variant: "segmented",
          value: "fast",
          options: [
            { value: "fast", label: "빠른" },
            { value: "precise", label: "정밀" },
          ],
          onChange: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].getAttribute("aria-checked")).toBe("false");
  });

  it("다른 옵션 클릭 시 onChange(value) 호출", () => {
    const onChange = vi.fn();
    render(
      <ToggleRow
        label="AI 보정 모드 기본값"
        control={{
          variant: "segmented",
          value: "fast",
          options: [
            { value: "fast", label: "빠른" },
            { value: "precise", label: "정밀" },
          ],
          onChange,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "정밀" }));
    expect(onChange).toHaveBeenCalledWith("precise");
  });

  it("segmented 는 항상 카드 is-active (선택값 있음)", () => {
    const { container } = render(
      <ToggleRow
        label="AI 보정 모드 기본값"
        control={{
          variant: "segmented",
          value: "fast",
          options: [
            { value: "fast", label: "빠른" },
            { value: "precise", label: "정밀" },
          ],
          onChange: vi.fn(),
        }}
      />,
    );
    const row = container.querySelector(".ais-toggle-row");
    expect(row?.classList.contains("is-active")).toBe(true);
  });

  it("segmented 버튼이 줄바꿈 가드 클래스 (.ais-ctl-seg-btn) 가짐", () => {
    /* 회귀 가드: globals.css 의 .ais-ctl-seg-btn 가 white-space:nowrap + min-width:44 강제.
     *  jsdom 은 외부 stylesheet 적용 안하므로 클래스 명시 자체만 검증. */
    render(
      <ToggleRow
        label="AI 보정 모드 기본값"
        control={{
          variant: "segmented",
          value: "fast",
          options: [
            { value: "fast", label: "빠른" },
            { value: "precise", label: "정밀" },
          ],
          onChange: vi.fn(),
        }}
      />,
    );
    const radios = screen.getAllByRole("radio");
    radios.forEach((r) => {
      expect(r.classList.contains("ais-ctl-seg-btn")).toBe(true);
    });
  });
});

describe("ToggleRow · 공용 props", () => {
  it("tone='violet' 시 data-tone 속성 + segmented 가 tone-violet 클래스", () => {
    const { container } = render(
      <ToggleRow
        label="라벨"
        tone="violet"
        control={{
          variant: "segmented",
          value: "a",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
          onChange: vi.fn(),
        }}
      />,
    );
    const row = container.querySelector(".ais-toggle-row");
    expect(row?.getAttribute("data-tone")).toBe("violet");
    const seg = container.querySelector(".ais-ctl-seg");
    expect(seg?.classList.contains("tone-violet")).toBe(true);
  });

  it("marker 미지정 시 marker DOM 노드 없음", () => {
    const { container } = render(
      <ToggleRow
        label="라벨"
        control={{ variant: "switch", checked: false, onChange: vi.fn() }}
      />,
    );
    expect(container.querySelector(".ais-toggle-row-marker")).toBeNull();
  });

  it("marker 지정 시 marker DOM 노드 + 본문 렌더", () => {
    const { container } = render(
      <ToggleRow
        label="라벨"
        marker="🧠"
        control={{ variant: "switch", checked: false, onChange: vi.fn() }}
      />,
    );
    const marker = container.querySelector(".ais-toggle-row-marker");
    expect(marker?.textContent).toBe("🧠");
  });

  it("desc 미지정 시 desc DOM 노드 없음", () => {
    const { container } = render(
      <ToggleRow
        label="라벨"
        control={{ variant: "switch", checked: false, onChange: vi.fn() }}
      />,
    );
    expect(container.querySelector(".ais-toggle-row-desc")).toBeNull();
  });
});
