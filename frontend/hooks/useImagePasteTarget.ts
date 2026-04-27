/**
 * useImagePasteTarget — 전역 Ctrl+V 클립보드 이미지 paste 리스너 공용 hook.
 * 2026-04-27 (C2-P1-7) — StudioUploadSlot + vision/compare/page.tsx 분산 listener 통합.
 *
 * 동작:
 *   1. document 에 paste 리스너 등록 (enabled=true 일 때)
 *   2. activeElement 가 textarea/input/contentEditable 인지 미리 계산
 *   3. shouldSkip(ctx) 가 true 반환하면 즉시 종료 (호출자 가드)
 *   4. 클립보드에서 첫 image/* 항목 추출 → 없으면 종료 (다른 listener 에 양보)
 *   5. e.preventDefault() + onImage(file, event) 콜백 호출
 *
 * 호출자가 결정하는 분기 (shouldSkip 으로 노출):
 *   - hover 가드: 멀티 슬롯 모드에서 호버 중인 슬롯만 응답
 *   - defaultPrevented: 다른 슬롯이 이미 처리한 경우 fallback 차단
 *   - activeIsInput: textarea/input focus 시 텍스트 paste 보존
 *
 * preventDefault 정책:
 *   - 이미지 추출 + onImage 호출 직전 한 번만 preventDefault.
 *   - 같은 phase 의 후속 listener 는 e.defaultPrevented=true 를 보고 fallback skip.
 *   - 등록 순서 (child mount → parent mount) 가 자손 우선 처리 보장.
 */

"use client";

import { useEffect, useRef } from "react";

interface PasteContext {
  event: ClipboardEvent;
  /** activeElement 가 textarea/input/contentEditable 면 true. */
  activeIsInput: boolean;
}

interface Options {
  /** false 면 리스너 등록 자체 skip. */
  enabled?: boolean;
  /**
   * onImage 호출 전 추가 가드. true 반환 시 즉시 종료 (preventDefault 안 함).
   * 호출자가 hover/defaultPrevented/activeIsInput 등 도메인별 가드 결정.
   */
  shouldSkip?: (ctx: PasteContext) => boolean;
  /**
   * 클립보드에서 첫 image/* 추출 성공 시 호출.
   * preventDefault 는 hook 이 자동 처리 — 호출자는 처리만 신경.
   */
  onImage: (file: File, event: ClipboardEvent) => void;
}

export function useImagePasteTarget({
  enabled = true,
  shouldSkip,
  onImage,
}: Options): void {
  // 콜백/가드는 ref 로 추적 — effect 재등록 없이 최신 값 사용 (이전 listener 패턴 일관).
  const onImageRef = useRef(onImage);
  const shouldSkipRef = useRef(shouldSkip);
  useEffect(() => {
    onImageRef.current = onImage;
  }, [onImage]);
  useEffect(() => {
    shouldSkipRef.current = shouldSkip;
  }, [shouldSkip]);

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const activeIsInput =
        !!active &&
        (active.tagName === "TEXTAREA" ||
          active.tagName === "INPUT" ||
          active.isContentEditable);

      if (shouldSkipRef.current?.({ event: e, activeIsInput })) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      let imageItem: DataTransferItem | null = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          imageItem = items[i];
          break;
        }
      }
      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;

      e.preventDefault();
      onImageRef.current(file, e);
    };

    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [enabled]);
}
