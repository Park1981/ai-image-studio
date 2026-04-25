/**
 * ComparisonAnalysisModal — "자세히" 클릭 시 오픈되는 5축 비교 분석 상세 모달.
 *
 * 구조:
 *  - 헤더: 비전 모델 + 분석 시각
 *  - 종합 매치율 (큰 dot + %)
 *  - 5축 막대 (점수 + 색상)
 *  - 항목별 코멘트 (영/한 토글) — vision-analyzer 패턴 동일
 *  - 종합 (영/한 토글)
 *
 * Lightbox 위에 띄울 수 있도록 z-index 80 (Lightbox 70 + 1).
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import type {
  ComparisonAnalysis,
  ComparisonScores,
  HistoryItem,
} from "@/lib/api-client";

// 5축 순서 + 한글 라벨 정의
const AXIS_LABELS: { key: keyof ComparisonScores; label: string }[] = [
  { key: "face_id", label: "얼굴 ID" },
  { key: "body_pose", label: "체형/포즈" },
  { key: "attire", label: "의상/누드 상태" },
  { key: "background", label: "배경 보존" },
  { key: "intent_fidelity", label: "의도 충실도" },
];

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
  // 영/한 토글 상태 — 기본값 "ko"
  const [lang, setLang] = useState<"en" | "ko">("ko");

  // 언어에 따라 코멘트/종합 텍스트 선택
  const comments = lang === "ko" ? analysis.comments_ko : analysis.comments_en;
  const summary = lang === "ko" ? analysis.summary_ko : analysis.summary_en;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="비교 분석 상세"
      onClick={(e) => {
        // 오버레이 배경 클릭 시에만 닫기 (모달 본문 클릭은 통과)
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
          width: "min(640px, 92vw)",
          maxHeight: "88vh",
          overflowY: "auto",
          background: "var(--bg)",
          borderRadius: "var(--radius-card)",
          boxShadow: "0 20px 60px rgba(0,0,0,.4)",
          border: "1px solid var(--line)",
        }}
      >
        {/* 헤더: 모델명 + 분석 시각 + 닫기 버튼 */}
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
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              비교 분석
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
              {/* fallback 모드였을 때 헤더에 amber 마커 표시 */}
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

        {/* 종합 매치율: 큰 dot + 숫자 */}
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
              종합 매치율
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

        {/* 5축 점수 막대 */}
        <div style={{ padding: "10px 18px 6px" }}>
          {AXIS_LABELS.map(({ key, label }) => (
            <AxisBar
              key={key}
              label={label}
              score={analysis.scores[key]}
            />
          ))}
        </div>

        {/* 항목별 코멘트 섹션 헤더 + 영/한 토글 */}
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

        {/* 5축 코멘트 행 */}
        <div style={{ padding: "0 18px 12px" }}>
          {AXIS_LABELS.map(({ key, label }) => (
            <CommentRow
              key={key}
              label={label}
              text={comments?.[key] || "—"}
            />
          ))}
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
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 헬퍼: 점수에 따른 색상 결정 (80+ 녹 / 50-79 노 / 0-49 적 / null 회색)
// ──────────────────────────────────────────────────────────────
function scoreColor(score: number | null): string {
  if (score == null) return "var(--ink-4)";
  if (score >= 80) return "var(--green-ink, #2f8a3a)";
  if (score >= 50) return "var(--amber-ink, #b8860b)";
  return "var(--red-ink, #c0392b)";
}

// ──────────────────────────────────────────────────────────────
// ScoreDot — 점수 색상의 원형 인디케이터
// ──────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────
// AxisBar — 5축 점수 막대 (0-100 너비 + 색상)
// score=null 이면 막대 0 너비 + "—" 텍스트
// ──────────────────────────────────────────────────────────────
function AxisBar({ label, score }: { label: string; score: number | null }) {
  const v = score ?? 0; // null 인 경우 0 너비
  const color = scoreColor(score);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr 50px",
        alignItems: "center",
        gap: 10,
        padding: "5px 0",
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{label}</span>
      {/* 막대 트랙 */}
      <div
        style={{
          height: 8,
          background: "var(--bg-2)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {/* 막대 채움 — width % = 점수값 */}
        <div
          style={{
            width: `${v}%`,
            height: "100%",
            background: color,
            transition: "width .25s",
          }}
        />
      </div>
      {/* 점수 숫자 — null 이면 "—" */}
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

// ──────────────────────────────────────────────────────────────
// CommentRow — 축 라벨 + 코멘트 텍스트 한 줄
// ──────────────────────────────────────────────────────────────
function CommentRow({ label, text }: { label: string; text: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr",
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

// ──────────────────────────────────────────────────────────────
// LangToggle — EN / KO 2버튼 토글 (vision-analyzer 패턴 동일)
// ──────────────────────────────────────────────────────────────
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
