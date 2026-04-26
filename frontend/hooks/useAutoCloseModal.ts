/**
 * useAutoCloseModal — task #5/#7 (2026-04-26)
 *
 * 4 페이지 (generate/edit/video/vision) 의 진행 모달 트리거 패턴 통합.
 *
 * 이전 패턴 (8줄 × 4 페이지 = 32줄 중복):
 *   const [progressOpen, setProgressOpen] = useState(false);
 *   const [prevGenerating, setPrevGenerating] = useState(generating);
 *   if (prevGenerating !== generating) {
 *     setPrevGenerating(generating);
 *     if (generating) setProgressOpen(true);
 *   }
 *   useEffect(() => {
 *     if (generating) return;
 *     if (!progressOpen) return;
 *     const t = setTimeout(() => setProgressOpen(false), 1200);
 *     return () => clearTimeout(t);
 *   }, [generating, progressOpen]);
 *
 * 신규 사용:
 *   const [progressOpen, setProgressOpen] = useAutoCloseModal(generating);
 *   // generating false → true 진입 시 자동 open
 *   // generating true → false 후 closeDelay(기본 1200ms) 자동 close
 *   // 사용자가 직접 close 한 상태(generating 도 false)면 재오픈 안 함
 */

"use client";

import { useEffect, useState } from "react";

export function useAutoCloseModal(
  active: boolean,
  closeDelay = 1200,
): [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(false);
  // active false → true 전이 감지 (React 공식 권장 패턴 — prev state in render)
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (active) setOpen(true);
  }

  // active 가 끝난 직후 closeDelay 후 자동 close — 사용자가 이미 닫았다면 effect 자체가 idle.
  useEffect(() => {
    if (active) return;
    if (!open) return;
    const t = setTimeout(() => setOpen(false), closeDelay);
    return () => clearTimeout(t);
  }, [active, open, closeDelay]);

  return [open, setOpen];
}
