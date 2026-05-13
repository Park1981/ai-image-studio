/**
 * CompareKeyAnchors — V4 key anchor 강조.
 * spec §5.3.5:
 *  - domainMatch == "mixed" → 메인 (카테고리 매트릭스 자리에) · 항상 펼침
 *  - 동도메인 (person/object_scene) → 매트릭스 아래 보조 섹션 · 토글 펼침
 *
 * 각 anchor row: [label] image1Ko → image2Ko (반응형)
 * 빈 배열이면 미렌더.
 */

"use client";

import { useState } from "react";

import type { CompareKeyAnchorJSON } from "@/lib/api/types";

import { pickCompareText } from "./compareLanguage";

interface Props {
  anchors: CompareKeyAnchorJSON[];
  domainMatch: "person" | "object_scene" | "mixed";
}

export default function CompareKeyAnchors({ anchors, domainMatch }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (anchors.length === 0) return null;

  const isMixed = domainMatch === "mixed";
  const open = isMixed || expanded;

  return (
    <div
      className="ais-compare-anchors"
      data-domain={domainMatch}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      {!isMixed && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={open}
          aria-label="key anchor 토글"
          style={{
            alignSelf: "flex-start",
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--line-1)",
            background: "transparent",
            fontSize: 12,
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          {expanded ? "▴ key anchor 접기" : "▾ key anchor 펼치기"}
        </button>
      )}
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {anchors.map((a, i) => (
            <AnchorRow key={`${a.label}-${i}`} anchor={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnchorRow({ anchor }: { anchor: CompareKeyAnchorJSON }) {
  const image1 = pickCompareText(anchor.image1Ko, anchor.image1);
  const image2 = pickCompareText(anchor.image2Ko, anchor.image2);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr auto 1fr",
        gap: 10,
        alignItems: "baseline",
        padding: "8px 12px",
        borderRadius: 8,
        background: "rgba(148, 163, 184, 0.06)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: 12,
          color: "var(--ink-2)",
          letterSpacing: 0.4,
        }}
      >
        {anchor.label}
      </span>
      <span lang={image1.lang} style={{ color: "var(--ink-1)" }}>
        {image1.text}
      </span>
      <span style={{ color: "var(--ink-3, #94a3b8)", fontWeight: 600 }}>
        →
      </span>
      <span lang={image2.lang} style={{ color: "var(--ink-1)" }}>
        {image2.text}
      </span>
    </div>
  );
}
