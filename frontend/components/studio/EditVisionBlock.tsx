/**
 * EditVisionBlock v2 - Edit 비전 구조 분석 매트릭스 표시 (spec 15장 · 2026-04-25).
 *
 * 도메인별 5 슬롯 × {action, note} 매트릭스.
 * 비교 분석 (ComparisonAnalysisCard) 5축 점수표와 시각적 쌍둥이.
 *
 * 재사용:
 *  - ProgressModal (수정 중 step 1 detail)
 *  - ImageLightbox / InfoPanel (Edit 이미지 상세)
 *
 * UI 구조:
 *   🎯 수정 의도 (intent · gemma4 정제 결과)
 *   📋 [도메인 한글 라벨] 분석
 *   슬롯 5행: [한글 라벨] [edit/preserve 배지] [note 한 줄]
 */

"use client";

import Icon, { type IconName } from "@/components/ui/Icon";
import {
  OBJECT_SCENE_SLOT_ORDER,
  PERSON_SLOT_ORDER,
  SLOT_LABELS_KO,
  type EditSlotEntry,
  type EditVisionAnalysis,
} from "@/lib/api/types";

export interface EditVisionBlockProps {
  analysis: EditVisionAnalysis;
  /** 헤더 (제목 + fallback 배지) on/off. ProgressModal DetailBox 안에 넣을 때 false. */
  showHeader?: boolean;
  /** 외곽 배경 on/off. 부모가 이미 카드 배경 가지고 있으면 false. */
  showBackground?: boolean;
}

export default function EditVisionBlock({
  analysis,
  showHeader = true,
  showBackground = true,
}: EditVisionBlockProps) {
  const isFallback = analysis.fallback;
  const slotOrder =
    analysis.domain === "person"
      ? PERSON_SLOT_ORDER
      : OBJECT_SCENE_SLOT_ORDER;
  const domainLabel =
    analysis.domain === "person" ? "인물 모드 분석" : "물체·풍경 모드 분석";

  const body = (
    <div
      style={{
        marginTop: showHeader ? 6 : 0,
        padding: showBackground ? "12px 14px" : 0,
        background: showBackground ? "var(--bg-2)" : "transparent",
        border: showBackground ? "1px solid var(--line)" : "none",
        borderRadius: showBackground ? 6 : 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* 🎯 수정 의도 (gemma4 정제) */}
      {analysis.intent && (
        <div>
          <SectionLabel icon="sparkle" text="수정 의도" />
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {analysis.intent}
          </p>
        </div>
      )}

      {/* 📋 도메인 분석 — summary + 5 슬롯 매트릭스 */}
      <div>
        <SectionLabel icon="image" text={domainLabel} />
        {analysis.summary && (
          <p
            style={{
              margin: "4px 0 8px 0",
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--ink-3)",
              fontStyle: "italic",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {analysis.summary}
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {slotOrder.map((key) => {
            const entry = analysis.slots[key];
            if (!entry) return null;
            return (
              <SlotRow
                key={key}
                label={SLOT_LABELS_KO[key] ?? key}
                entry={entry}
              />
            );
          })}
        </div>
      </div>
    </div>
  );

  if (!showHeader) return body;

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--ink-3)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Icon name="image" size={11} />
        비전 모델 분석
        {isFallback && (
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              padding: "1px 5px",
              marginLeft: 4,
              borderRadius: 4,
              border: "1px solid rgba(250,173,20,.35)",
              background: "var(--amber-soft)",
              color: "var(--amber-ink)",
              letterSpacing: ".04em",
              textTransform: "uppercase",
            }}
          >
            fallback
          </span>
        )}
      </div>
      {body}
    </div>
  );
}

/** 작은 섹션 라벨 (🎯 수정 의도 / 📋 인물 모드 분석) */
function SectionLabel({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color: "var(--ink-3)",
        textTransform: "uppercase",
        letterSpacing: ".06em",
        display: "flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <Icon name={icon} size={11} />
      {text}
    </div>
  );
}

/** 슬롯 1행 — [한글 라벨] [edit/preserve 배지] [note 한 줄] */
function SlotRow({ label, entry }: { label: string; entry: EditSlotEntry }) {
  const isEdit = entry.action === "edit";

  // 액션 배지 — edit 은 강조 (blue), preserve 는 중립 (green-ish)
  const badgeStyle: React.CSSProperties = isEdit
    ? {
        background: "rgba(64,120,255,.10)",
        border: "1px solid rgba(64,120,255,.32)",
        color: "#2B4FB8",
      }
    : {
        background: "rgba(56,142,60,.08)",
        border: "1px solid rgba(56,142,60,.30)",
        color: "#2E7D32",
      };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "84px 60px 1fr",
        alignItems: "start",
        gap: 8,
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--ink-2)",
          paddingTop: 2,
        }}
      >
        {label}
      </div>
      <div>
        <span
          style={{
            ...badgeStyle,
            fontSize: 10.5,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 10,
            letterSpacing: ".03em",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            whiteSpace: "nowrap",
          }}
        >
          {isEdit ? "🔵 수정" : "🟢 유지"}
        </span>
      </div>
      <div
        style={{
          color: "var(--ink-2)",
          paddingTop: 2,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {entry.note || (
          <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>
            (설명 없음)
          </span>
        )}
      </div>
    </div>
  );
}
