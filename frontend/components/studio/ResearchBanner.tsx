/**
 * ResearchBanner — Generate 페이지의 Claude 프롬프트 조사 토글.
 * 2026-04-23 Opus F4: generate/page.tsx 에서 분리.
 * 2026-04-24: 결과를 토스트 대신 배너 내부 인라인으로 표시 (휘발성 제거).
 *
 * 2026-04-27 디자인 통일 (오빠 피드백):
 *  - 체크박스 → Toggle (align="right" tone="amber") · Lightning 카드와 동일 패턴
 *  - "힌트 미리 받기" 버튼 + 결과 인라인 영역 UI 제거 (오빠 피드백 — UI 만 빼기)
 *  - useGeneratePipeline.researchPreview hook 자체는 유지 (향후 살릴 때 빠르게)
 *  - ResearchBanner 단순 Toggle 카드 — checked / onChange 만 받음
 *
 * 2026-05-02 (Phase 1.5.2 · V5 적용):
 *  - flat=true — 외부 V5 카드 wrap (.ais-toggle-card .ais-sig-claude) 안 inline
 *  - 외부 카드가 색 책임 → 자체 박스 제거 (이중 박스 회피)
 */

"use client";

import { Toggle } from "@/components/ui/primitives";

interface ResearchBannerProps {
  /** 토글 상태 */
  checked: boolean;
  /** 토글 변경 콜백 */
  onChange: (v: boolean) => void;
}

export default function ResearchBanner({
  checked,
  onChange,
}: ResearchBannerProps) {
  return (
    <Toggle
      flat
      checked={checked}
      onChange={onChange}
      align="right"
      tone="amber"
      label="🔍 Claude 프롬프트 조사"
      desc="Claude 가 프롬프트를 분석해 개선 힌트를 반영합니다 · 약 +15s"
    />
  );
}
