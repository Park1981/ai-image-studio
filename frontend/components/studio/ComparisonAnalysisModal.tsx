/**
 * ComparisonAnalysisModal v3 (spec 16 · 2026-04-25)
 *
 * 도메인 분기 + 의도 컨텍스트 점수 표시. 옛 row 호환.
 *
 * 분기:
 *   - analysis.slots 있음 → v3 표시 (domain 으로 라벨 셋 결정 + 의도 배지)
 *   - analysis.slots 없고 analysis.scores 있음 → v1 폴백 (옛 5축 라벨)
 *
 * 구조:
 *   - 헤더: 비전 모델 + 분석 시각 + (도메인 또는 fallback 마커)
 *   - 종합 매치율 (큰 dot + %)
 *   - 슬롯 5행: [한글 라벨] [의도 배지] [점수 막대 + 점수]
 *   - 항목별 코멘트 (영/한 토글)
 *   - 종합 단락
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import {
  TransformPromptBox,
  UncertainBox,
} from "@/components/studio/CompareExtraBoxes";
import {
  COMPARISON_LEGACY_AXES,
  COMPARISON_LEGACY_LABELS_KO,
  COMPARISON_OBJECT_SCENE_SLOTS,
  COMPARISON_PERSON_SLOTS,
  SLOT_LABELS_KO,
  type ComparisonAnalysis,
  type ComparisonSlotEntry,
  type HistoryItem,
} from "@/lib/api/types";

interface Props {
  item: HistoryItem;
  analysis: ComparisonAnalysis;
  onClose: () => void;
}

export default function ComparisonAnalysisModal({
  item: _item, // eslint-disable-line @typescript-eslint/no-unused-vars
  analysis,
  onClose,
}: Props) {
  // 영/한 토글
  const [lang, setLang] = useState<"en" | "ko">("ko");
  const summary = lang === "ko" ? analysis.summary_ko : analysis.summary_en;

  // v3 vs v1 분기
  const isV3 = !!analysis.slots && Object.keys(analysis.slots).length > 0;
  const slotOrder = isV3
    ? analysis.domain === "person"
      ? COMPARISON_PERSON_SLOTS
      : COMPARISON_OBJECT_SCENE_SLOTS
    : null;

  const domainLabel = isV3
    ? analysis.domain === "person"
      ? "인물 모드"
      : "물체·풍경 모드"
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="비교 분석 상세"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(8,8,10,.72)",
        display: "grid",
        placeItems: "center",
        animation: "fade-in .14s ease",
      }}
    >
      <div
        style={{
          width: "min(680px, 92vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "var(--bg)",
          borderRadius: "var(--radius-card)",
          boxShadow: "0 20px 60px rgba(0,0,0,.4)",
          border: "1px solid var(--line)",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <div
              style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
            >
              비교 분석
              {domainLabel && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 10.5,
                    fontWeight: 500,
                    color: "var(--ink-3)",
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: "var(--bg-2)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {domainLabel}
                </span>
              )}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                marginTop: 2,
              }}
            >
              {analysis.visionModel} ·{" "}
              {new Date(analysis.analyzedAt).toLocaleString("ko-KR", {
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {analysis.fallback && (
                <span style={{ color: "var(--amber-ink)", marginLeft: 6 }}>
                  · fallback
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: 6,
              borderRadius: "var(--radius-sm)",
              color: "var(--ink-3)",
            }}
            title="닫기"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* 종합 매치율 */}
        <div
          style={{
            padding: "18px 18px 6px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <ScoreDot score={analysis.overall} size={20} />
          <div>
            <div style={{ fontSize: 11, color: "var(--ink-4)" }}>
              종합 매치율 {isV3 && "(의도 부합도)"}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: scoreColor(analysis.overall),
              }}
            >
              {analysis.overall != null ? `${analysis.overall}%` : "—"}
            </div>
          </div>
        </div>

        {/* 슬롯 점수 막대 (v3 또는 v1) */}
        <div style={{ padding: "10px 18px 6px" }}>
          {isV3 && slotOrder
            ? slotOrder.map((key) => {
                const entry = analysis.slots?.[key];
                if (!entry) return null;
                return (
                  <SlotBar
                    key={key}
                    label={SLOT_LABELS_KO[key] ?? key}
                    entry={entry}
                  />
                );
              })
            : COMPARISON_LEGACY_AXES.map((key) => (
                <LegacyBar
                  key={key}
                  label={COMPARISON_LEGACY_LABELS_KO[key]}
                  score={analysis.scores?.[key] ?? null}
                />
              ))}
        </div>

        {/* 항목별 코멘트 + 영/한 토글 */}
        <div
          style={{
            padding: "16px 18px 8px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "var(--ink-3)",
            }}
          >
            항목별 코멘트
          </div>
          <LangToggle lang={lang} onChange={setLang} />
        </div>

        <div style={{ padding: "0 18px 12px" }}>
          {isV3 && slotOrder
            ? slotOrder.map((key) => {
                const entry = analysis.slots?.[key];
                if (!entry) return null;
                const text =
                  lang === "ko"
                    ? entry.commentKo || entry.commentEn || "—"
                    : entry.commentEn || "—";
                return (
                  <CommentRow
                    key={key}
                    label={SLOT_LABELS_KO[key] ?? key}
                    text={text}
                  />
                );
              })
            : COMPARISON_LEGACY_AXES.map((key) => {
                const text =
                  lang === "ko"
                    ? analysis.comments_ko?.[key] || "—"
                    : analysis.comments_en?.[key] || "—";
                return (
                  <CommentRow
                    key={key}
                    label={COMPARISON_LEGACY_LABELS_KO[key]}
                    text={text}
                  />
                );
              })}
        </div>

        {/* 종합 단락 */}
        <div
          style={{
            padding: "12px 18px 20px",
            borderTop: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".08em",
              color: "var(--ink-3)",
              marginBottom: 8,
            }}
          >
            종합
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
            }}
          >
            {summary || "—"}
          </div>
        </div>

        {/* spec 19 후속 — Transform Prompt (Edit 의미: 추가 수정 가이드) */}
        {(analysis.transform_prompt_ko || analysis.transform_prompt_en) && (
          <div
            style={{
              padding: "0 18px 14px",
              borderTop: "1px solid var(--line)",
              paddingTop: 14,
            }}
          >
            <TransformPromptBox
              textKo={analysis.transform_prompt_ko}
              textEn={analysis.transform_prompt_en}
              contextLabel="추가 수정 가이드"
            />
          </div>
        )}

        {/* spec 19 후속 — Uncertain (비교 못한 영역) */}
        {(analysis.uncertain_ko || analysis.uncertain_en) && (
          <div style={{ padding: "0 18px 18px" }}>
            <UncertainBox
              textKo={analysis.uncertain_ko}
              textEn={analysis.uncertain_en}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score == null) return "var(--ink-4)";
  if (score >= 80) return "var(--green-ink, #2f8a3a)";
  if (score >= 50) return "var(--amber-ink, #b8860b)";
  return "var(--red-ink, #c0392b)";
}

function ScoreDot({
  score,
  size = 12,
}: {
  score: number | null;
  size?: number;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: scoreColor(score),
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.1)",
        flexShrink: 0,
      }}
    />
  );
}

/** v3 슬롯 막대 — 라벨 + 의도 배지 + 점수 막대 + 점수 */
function SlotBar({
  label,
  entry,
}: {
  label: string;
  entry: ComparisonSlotEntry;
}) {
  const v = entry.score ?? 0;
  const color = scoreColor(entry.score);
  const isEdit = entry.intent === "edit";
  const intentBadge = isEdit
    ? {
        text: "🔵 변경",
        bg: "rgba(64,120,255,.10)",
        border: "rgba(64,120,255,.32)",
        color: "#2B4FB8",
      }
    : {
        text: "🟢 보존",
        bg: "rgba(56,142,60,.08)",
        border: "rgba(56,142,60,.30)",
        color: "#2E7D32",
      };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 70px 1fr 50px",
        alignItems: "center",
        gap: 10,
        padding: "5px 0",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{label}</span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: "2px 6px",
          borderRadius: 8,
          background: intentBadge.bg,
          border: `1px solid ${intentBadge.border}`,
          color: intentBadge.color,
          letterSpacing: ".02em",
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {intentBadge.text}
      </span>
      <div
        style={{
          height: 8,
          background: "var(--bg-2)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${v}%`,
            height: "100%",
            background: color,
            transition: "width .25s",
          }}
        />
      </div>
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          color,
          textAlign: "right",
          fontWeight: 600,
        }}
      >
        {entry.score ?? "—"}
      </span>
    </div>
  );
}

/** v1 옛 5축 막대 (호환만) */
function LegacyBar({
  label,
  score,
}: {
  label: string;
  score: number | null;
}) {
  const v = score ?? 0;
  const color = scoreColor(score);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr 50px",
        alignItems: "center",
        gap: 10,
        padding: "5px 0",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{label}</span>
      <div
        style={{
          height: 8,
          background: "var(--bg-2)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${v}%`,
            height: "100%",
            background: color,
            transition: "width .25s",
          }}
        />
      </div>
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          color,
          textAlign: "right",
          fontWeight: 600,
        }}
      >
        {score ?? "—"}
      </span>
    </div>
  );
}

function CommentRow({ label, text }: { label: string; text: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 10,
        padding: "6px 0",
        fontSize: 12,
        lineHeight: 1.5,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <span style={{ color: "var(--ink)", whiteSpace: "pre-wrap" }}>
        {text}
      </span>
    </div>
  );
}

function LangToggle({
  lang,
  onChange,
}: {
  lang: "en" | "ko";
  onChange: (l: "en" | "ko") => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
      }}
    >
      {(["en", "ko"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: lang === l ? 600 : 400,
            background: lang === l ? "var(--surface)" : "transparent",
            color: lang === l ? "var(--ink)" : "var(--ink-3)",
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
