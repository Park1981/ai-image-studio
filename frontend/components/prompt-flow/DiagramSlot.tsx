/**
 * DiagramSlot — mode 별 다이어그램 자리.
 *
 * generate: GenerateUseCaseDiagram 컴포넌트가 children 으로 들어옴.
 * edit / video: 다이어그램 준비 중 placeholder 노출 (오빠가 별도 작업 중).
 *
 * 추후 PNG/SVG/React 어떤 형태든 이 슬롯의 children 으로 끼우면 됨.
 */

"use client";

import type { ReactNode } from "react";
import Icon from "@/components/ui/Icon";

export default function DiagramSlot({
  mode,
  children,
}: {
  mode: "generate" | "edit" | "video";
  children?: ReactNode;
}) {
  // children 이 있으면 (= generate 처럼 실 다이어그램이 들어오면) 그대로 렌더.
  if (children) {
    return <>{children}</>;
  }

  // children 없을 때 (= edit / video) placeholder.
  const modeLabel =
    mode === "edit" ? "수정 모드" : mode === "video" ? "영상 모드" : "이 모드";

  return (
    <section
      aria-label={`${modeLabel} 다이어그램 영역`}
      style={{
        margin: "32px 0",
        padding: "48px 32px",
        border: "2px dashed var(--line)",
        borderRadius: "var(--radius-xl)",
        background:
          "repeating-linear-gradient(45deg, var(--surface), var(--surface) 12px, var(--bg-2) 12px, var(--bg-2) 24px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        textAlign: "center",
        minHeight: 280,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <Icon name="grid" size={24} />
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: ".18em",
          color: "var(--ink-4)",
          fontFamily: "Consolas, SFMono-Regular, monospace",
        }}
      >
        DIAGRAM · COMING SOON
      </div>
      <h3
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 660,
          color: "var(--ink)",
          letterSpacing: 0,
          lineHeight: 1.3,
        }}
      >
        {modeLabel} 다이어그램 준비 중입니다
      </h3>
      <p
        style={{
          margin: 0,
          maxWidth: 460,
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--ink-3)",
          letterSpacing: 0,
        }}
      >
        {modeLabel} 의 변환 흐름을 한눈에 보여 드리는 다이어그램을 준비하고
        있습니다. 그 사이에는 아래 단계 설명을 통해 전체 흐름을 확인하실 수
        있습니다.
      </p>
    </section>
  );
}
