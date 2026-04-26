/**
 * useAutoGrowTextarea — task #5/#7 (2026-04-26)
 *
 * 3 페이지 (generate/edit/video) 의 prompt textarea auto-grow 패턴 통합.
 *
 * 이전 패턴 (8줄 × 3 페이지 = 24줄 중복):
 *   const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
 *   const autoGrow = (el: HTMLTextAreaElement) => {
 *     el.style.height = "auto";
 *     el.style.height = `${el.scrollHeight}px`;
 *   };
 *   useEffect(() => {
 *     if (promptTextareaRef.current) autoGrow(promptTextareaRef.current);
 *   }, [prompt]);
 *
 * 신규 사용:
 *   const textareaRef = useAutoGrowTextarea(prompt);
 *   <textarea ref={textareaRef} ... />
 */

"use client";

import { useEffect, useRef } from "react";

export function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // scrollHeight 가 정확한 content 높이 — 'auto' 로 먼저 리셋해야 줄어들기도 가능.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}
