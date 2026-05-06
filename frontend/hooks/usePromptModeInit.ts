/**
 * usePromptModeInit — settings 의 promptEnhanceMode 를 페이지 store 로 *마운트 1회만* sync.
 *
 * Phase 2 (2026-05-01 · Codex Phase 4 리뷰 Medium #2 fix):
 *   settings 변경이 페이지 session 토글을 즉시 덮어쓰던 옛 동작 차단 — settings 변경 효과는
 *   페이지 재진입 시점부터 반영 (= "session-only" 정책 정합).
 *
 * 2026-05-06 (Codex finding 3): Generate/Edit/Video LeftPanel 3 페이지 동일 패턴 dedup.
 *   각 store 의 setPromptMode 시그니처는 (v: "fast" | "precise") => void 로 통일됨.
 */

"use client";

import { useEffect, useRef } from "react";
import {
  useSettingsStore,
  type PromptEnhanceMode,
} from "@/stores/useSettingsStore";

export function usePromptModeInit(
  setPromptMode: (mode: PromptEnhanceMode) => void,
) {
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    setPromptMode(useSettingsStore.getState().promptEnhanceMode);
  }, [setPromptMode]);
}
