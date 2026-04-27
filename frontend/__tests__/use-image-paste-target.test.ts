/**
 * useImagePasteTarget — 단위 테스트.
 *
 * jsdom 환경에서 document.dispatchEvent('paste') 시뮬레이션.
 * ClipboardEvent 자체는 jsdom 에서 생성자 사용 가능, items 배열은
 * 모킹된 DataTransferItem[] 로 직접 주입.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useImagePasteTarget } from "@/hooks/useImagePasteTarget";

function fakeClipboardItem(type: string, file: File | null): DataTransferItem {
  return {
    type,
    kind: "file",
    getAsFile: () => file,
    getAsString: () => undefined,
    webkitGetAsEntry: () => null,
  } as unknown as DataTransferItem;
}

function dispatchPaste(items: DataTransferItem[]): ClipboardEvent {
  // jsdom 에서 ClipboardEvent 의 clipboardData 는 readonly 라 직접 set 불가.
  // Object.defineProperty 로 우회 + cancelable=true 로 preventDefault 가능.
  const event = new Event("paste", { cancelable: true, bubbles: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { items },
    writable: false,
  });
  document.dispatchEvent(event);
  return event;
}

describe("useImagePasteTarget", () => {
  it("calls onImage with the first image/* file from clipboard", () => {
    const file = new File(["fake"], "a.png", { type: "image/png" });
    const onImage = vi.fn();

    renderHook(() => useImagePasteTarget({ onImage }));

    const event = dispatchPaste([fakeClipboardItem("image/png", file)]);

    expect(onImage).toHaveBeenCalledTimes(1);
    expect(onImage.mock.calls[0][0]).toBe(file);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores paste events when enabled=false", () => {
    const onImage = vi.fn();
    const file = new File(["x"], "x.png", { type: "image/png" });

    renderHook(() => useImagePasteTarget({ enabled: false, onImage }));

    const event = dispatchPaste([fakeClipboardItem("image/png", file)]);

    expect(onImage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("skips when shouldSkip returns true and does not preventDefault", () => {
    const onImage = vi.fn();
    const shouldSkip = vi.fn().mockReturnValue(true);
    const file = new File(["x"], "x.png", { type: "image/png" });

    renderHook(() => useImagePasteTarget({ shouldSkip, onImage }));

    const event = dispatchPaste([fakeClipboardItem("image/png", file)]);

    expect(shouldSkip).toHaveBeenCalled();
    expect(onImage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores clipboard without any image item", () => {
    const onImage = vi.fn();
    const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { items: [fakeClipboardItem("text/plain", null)] },
    });

    renderHook(() => useImagePasteTarget({ onImage }));
    document.dispatchEvent(event);

    expect(onImage).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("provides activeIsInput to shouldSkip when textarea has focus", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    expect(document.activeElement).toBe(ta);

    const file = new File(["x"], "x.png", { type: "image/png" });
    let observed: { activeIsInput: boolean } | null = null;
    const shouldSkip = vi.fn((ctx: { event: ClipboardEvent; activeIsInput: boolean }) => {
      observed = { activeIsInput: ctx.activeIsInput };
      return ctx.activeIsInput;
    });
    const onImage = vi.fn();

    renderHook(() => useImagePasteTarget({ shouldSkip, onImage }));

    dispatchPaste([fakeClipboardItem("image/png", file)]);

    expect(observed).not.toBeNull();
    expect(observed!.activeIsInput).toBe(true);
    expect(onImage).not.toHaveBeenCalled();

    document.body.removeChild(ta);
  });

  it("removes the listener on unmount", () => {
    const onImage = vi.fn();
    const file = new File(["x"], "x.png", { type: "image/png" });

    const { unmount } = renderHook(() => useImagePasteTarget({ onImage }));
    unmount();

    dispatchPaste([fakeClipboardItem("image/png", file)]);

    expect(onImage).not.toHaveBeenCalled();
  });
});
