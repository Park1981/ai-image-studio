/**
 * StudioLoadingState — 결과 카드 내부 로딩 공통화 (audit R2-4).
 *
 * 기존: VisionResultCard / VideoPlayerCard / Compare AnalysisPanel 각각 개별 loading
 *   구현. Spinner 위치·padding·힌트 문구 스타일 다 달랐음.
 *
 * 정책 (audit §4.5):
 *   - 결과 카드 내부 로딩은 **lightweight placeholder**.
 *   - 상세 진행률은 ProgressModal / AnalysisProgressModal 이 단일 primary.
 *   - 이 컴포넌트는 percent bar 를 받지 않음 (의도적).
 *
 * Size:
 *   - normal: 28px 22px padding · 결과 카드 내부 (Vision/Video)
 *   - panel: flex center · height 100% · Compare 패널 내부
 *
 * props:
 *   - title: "분석 중…", "영상 생성 중…" 등 현재 단계 라벨
 *   - description?: 부연 설명 ("평균 5~10초 소요")
 */

"use client";

import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/primitives";

type Size = "normal" | "panel";

export default function StudioLoadingState({
  size = "normal",
  title,
  description,
  children,
}: {
  size?: Size;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  if (size === "panel") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          height: "100%",
          minHeight: 120,
          color: "var(--ink-3)",
          padding: 20,
        }}
      >
        <Spinner />
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--ink-2)",
            textAlign: "center",
          }}
        >
          {title}
        </div>
        {description && (
          <div
            style={{
              fontSize: 11.5,
              color: "var(--ink-4)",
              textAlign: "center",
            }}
          >
            {description}
          </div>
        )}
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        padding: "28px 22px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        color: "var(--ink-3)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <Spinner />
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--ink-2)",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        {title}
      </div>
      {description && (
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-4)" }}
        >
          {description}
        </div>
      )}
      {children}
    </div>
  );
}
