/**
 * CompareCategoryMatrix — V4 5 카테고리 × 3-col 매트릭스.
 * spec §5.3.4: composition / subject / clothing_or_materials / environment / lighting_camera_style,
 * 3 col (image1_ko / image2_ko / diff_ko), 각 row 우상단 영문 펼침 토글.
 *
 * 카테고리 라벨 한국어:
 *   composition → 구도
 *   subject → 피사체
 *   clothing_or_materials → 의상·재질
 *   environment → 환경
 *   lighting_camera_style → 광원·카메라·스타일
 *
 * mixed 도메인은 부모가 안 렌더 — 이 컴포넌트는 렌더 책임만.
 * 빈 dict 도 미렌더 (방어 가드).
 */

"use client";

import { useState } from "react";

import type { CompareCategoryDiffJSON } from "@/lib/api/types";

interface Props {
  categoryDiffs: Record<string, CompareCategoryDiffJSON>;
}

const CATEGORY_ORDER = [
  "composition",
  "subject",
  "clothing_or_materials",
  "environment",
  "lighting_camera_style",
] as const;

const CATEGORY_LABELS_KO: Record<string, string> = {
  composition: "구도",
  subject: "피사체",
  clothing_or_materials: "의상·재질",
  environment: "환경",
  lighting_camera_style: "광원·카메라·스타일",
};

export default function CompareCategoryMatrix({ categoryDiffs }: Props) {
  const presentKeys = CATEGORY_ORDER.filter((k) => categoryDiffs[k]);
  if (presentKeys.length === 0) return null;

  return (
    <div
      className="ais-compare-matrix"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {presentKeys.map((key) => (
        <CategoryRow
          key={key}
          categoryKey={key}
          labelKo={CATEGORY_LABELS_KO[key] ?? key}
          row={categoryDiffs[key]!}
        />
      ))}
    </div>
  );
}

function CategoryRow({
  categoryKey,
  labelKo,
  row,
}: {
  categoryKey: string;
  labelKo: string;
  row: CompareCategoryDiffJSON;
}) {
  const [showEn, setShowEn] = useState(false);
  return (
    <div
      className="ais-compare-matrix-row"
      data-category={categoryKey}
      style={{
        border: "1px solid var(--line-1, rgba(148, 163, 184, 0.2))",
        borderRadius: 10,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--ink-1)" }}>
          {labelKo}
        </div>
        <button
          type="button"
          onClick={() => setShowEn((v) => !v)}
          aria-label={showEn ? "영문 닫기" : "영문 펼치기 (en)"}
          aria-expanded={showEn}
          style={{
            padding: "2px 8px",
            borderRadius: 6,
            border: "1px solid var(--line-1)",
            background: "transparent",
            fontSize: 11,
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          {showEn ? "▴ en" : "▾ en"}
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink-2)",
        }}
      >
        <Cell ko={row.image1Ko} en={row.image1} showEn={showEn} eyebrow="A" />
        <Cell ko={row.image2Ko} en={row.image2} showEn={showEn} eyebrow="B" />
        <Cell ko={row.diffKo} en={row.diff} showEn={showEn} eyebrow="차이" />
      </div>
    </div>
  );
}

function Cell({
  ko,
  en,
  showEn,
  eyebrow,
}: {
  ko: string;
  en: string;
  showEn: boolean;
  eyebrow: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          fontSize: 10,
          color: "var(--ink-3, #94a3b8)",
          letterSpacing: 0.4,
          fontWeight: 600,
        }}
      >
        {eyebrow}
      </div>
      <div>{ko}</div>
      {showEn && (
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-3, #94a3b8)",
            fontStyle: "italic",
          }}
        >
          {en}
        </div>
      )}
    </div>
  );
}
