/**
 * VisionModelSelector 컴포넌트 단위 테스트.
 * 8B / Thinking 모델 카드 렌더 + 클릭 동작 검증.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import VisionModelSelector from "@/components/studio/VisionModelSelector";

describe("VisionModelSelector", () => {
  it("8B / Thinking 카드 두 장 렌더 + value 인 카드에 active 표시", () => {
    render(<VisionModelSelector value="qwen3-vl:8b" onChange={() => {}} />);
    // role="radio" 버튼 두 장 존재 확인
    const buttons = screen.getAllByRole("radio");
    expect(buttons.length).toBe(2);
    expect(screen.getByText(/8B/i)).toBeInTheDocument();
    expect(screen.getByText(/Thinking/i)).toBeInTheDocument();
    // 활성 버튼 (8B) 에 aria-checked="true"
    const activeBtn = screen.getByText(/8B/i).closest("button");
    expect(activeBtn).toHaveAttribute("aria-checked", "true");
    // 비활성 버튼 (Thinking) 에 aria-checked="false"
    const inactiveBtn = screen.getByText(/Thinking/i).closest("button");
    expect(inactiveBtn).toHaveAttribute("aria-checked", "false");
  });

  it("카드 클릭 시 onChange 호출 + 선택 모델 ID 전달", () => {
    const onChange = vi.fn();
    render(<VisionModelSelector value="qwen3-vl:8b" onChange={onChange} />);
    // Thinking 버튼 클릭 → onChange 에 Thinking 모델 ID 전달
    fireEvent.click(screen.getByText(/Thinking/i).closest("button")!);
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining("thinking"));
  });

  it("disabled prop 전달 시 버튼 클릭 비활성화", () => {
    const onChange = vi.fn();
    render(
      <VisionModelSelector value="qwen3-vl:8b" onChange={onChange} disabled />,
    );
    fireEvent.click(screen.getByText(/Thinking/i).closest("button")!);
    // disabled 상태에서는 onChange 호출 안 됨
    expect(onChange).not.toHaveBeenCalled();
  });
});
