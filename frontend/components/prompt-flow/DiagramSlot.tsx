/**
 * DiagramSlot — mode 별 다이어그램 자리 (PNG 자동 임베드 + override 가능).
 *
 * 동작:
 *   - children 있음: children 우선 (예: React 컴포넌트 직접 임베드)
 *   - children 없음: /prompt-flow/{mode}-flow.png 자동 임베드
 *     (generate-flow.png / edit-flow.png / video-flow.png)
 */

"use client";

import type { ReactNode } from "react";
import Image from "next/image";

const DIAGRAM_DIMENSIONS: Record<
  "generate" | "edit" | "video",
  { src: string; alt: string; width: number; height: number }
> = {
  generate: {
    src: "/prompt-flow/generate-flow.png",
    alt: "이미지 생성 흐름 다이어그램",
    width: 1600,
    height: 900,
  },
  edit: {
    src: "/prompt-flow/edit-flow.png",
    alt: "이미지 수정 흐름 다이어그램",
    width: 1600,
    height: 900,
  },
  video: {
    src: "/prompt-flow/video-flow.png",
    alt: "영상 생성 흐름 다이어그램",
    width: 1600,
    height: 900,
  },
};

export default function DiagramSlot({
  mode,
  children,
}: {
  mode: "generate" | "edit" | "video";
  /** override — 있으면 이걸 그대로 렌더. 없으면 mode 별 PNG 자동 임베드. */
  children?: ReactNode;
}) {
  if (children) {
    return <>{children}</>;
  }

  const d = DIAGRAM_DIMENSIONS[mode];

  return (
    <section
      aria-label={d.alt}
      style={{
        margin: "32px 0",
        borderRadius: "var(--radius-xl)",
        overflow: "hidden",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <Image
        src={d.src}
        alt={d.alt}
        width={d.width}
        height={d.height}
        priority={mode === "generate"}
        sizes="(min-width: 1280px) 1280px, 100vw"
        style={{
          width: "100%",
          height: "auto",
          display: "block",
        }}
      />
    </section>
  );
}
