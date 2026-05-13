/**
 * CompareUncertainBox — V4 uncertain 박스.
 * spec §5.3.8: 비어있지 않으면 페이지 끝에 작은 회색 박스로 영문+한국어 노출.
 * 둘 다 빈 문자열이면 미렌더.
 */

"use client";

import Icon from "@/components/ui/Icon";

import { hasUsableKorean } from "./compareLanguage";

interface Props {
  uncertainEn: string;
  uncertainKo: string;
}

export default function CompareUncertainBox({
  uncertainEn,
  uncertainKo,
}: Props) {
  const en = uncertainEn.trim();
  const ko = uncertainKo.trim();
  const canShowKo = hasUsableKorean(ko);
  const fallbackText = !en && !canShowKo ? ko : "";
  if (!en && !ko) return null;

  return (
    <div
      className="ais-compare-uncertain"
      style={{
        padding: 12,
        borderRadius: 8,
        background: "rgba(148, 163, 184, 0.08)",
        border: "1px dashed rgba(148, 163, 184, 0.3)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.4,
          color: "var(--ink-3, #94a3b8)",
          textTransform: "uppercase",
        }}
      >
        <Icon name="search" size={11} />
        UNCERTAIN · 비교 못한 영역
      </div>
      {canShowKo && (
        <div lang="ko" style={{ color: "var(--ink-2)", lineHeight: 1.55 }}>
          {ko}
        </div>
      )}
      {(en || fallbackText) && (
        <div
          lang="en"
          style={{
            color: "var(--ink-3, #94a3b8)",
            lineHeight: 1.55,
            fontStyle: "italic",
            fontSize: 11,
          }}
        >
          {en || fallbackText}
        </div>
      )}
    </div>
  );
}
