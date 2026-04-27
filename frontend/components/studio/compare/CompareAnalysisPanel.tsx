/**
 * CompareAnalysisPanel — /vision/compare 우 하단 분석 결과.
 * 2026-04-27 (C2-P1-1): vision/compare/page.tsx 분해 — 페이지에서 추출.
 *
 * 헤더 (5축 비교 분석 라벨 + 종합 점수 chip) + 본문 분기:
 *   - running: 로딩 상태
 *   - !analysis: 빈 상태
 *   - analysis.fallback: amber 폴백 카드
 *   - 정상: AxisRow 5개 + 총평 + transform_prompt + uncertain
 */

"use client";

import {
  TransformPromptBox,
  UncertainBox,
} from "@/components/studio/CompareExtraBoxes";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioLoadingState from "@/components/studio/StudioLoadingState";
import Icon from "@/components/ui/Icon";
import type { VisionCompareAnalysis } from "@/lib/api/types";

const AXIS_LABELS_KO: Record<keyof VisionCompareAnalysis["scores"], string> = {
  composition: "구성",
  color: "색감",
  subject: "피사체",
  mood: "분위기",
  quality: "품질",
};

const AXIS_ORDER: Array<keyof VisionCompareAnalysis["scores"]> = [
  "composition",
  "color",
  "subject",
  "mood",
  "quality",
];

interface Props {
  running: boolean;
  analysis: VisionCompareAnalysis | null;
}

export default function CompareAnalysisPanel({ running, analysis }: Props) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 262,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink-2)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="grid" size={13} />
          5축 비교 분석
        </div>
        {analysis && !analysis.fallback && (
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              padding: "3px 8px",
              background: "var(--bg-2)",
              borderRadius: "var(--radius-full)",
            }}
          >
            종합 {analysis.overall}%
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {running ? (
          <AnalysisLoading />
        ) : !analysis ? (
          <AnalysisEmpty />
        ) : analysis.fallback ? (
          <AnalysisFallback summary={analysis.summary_ko} />
        ) : (
          <AnalysisFilled analysis={analysis} />
        )}
      </div>
    </div>
  );
}

function AnalysisLoading() {
  return (
    <StudioLoadingState
      size="panel"
      title="비교 분석 중…"
      description="qwen2.5vl 이 두 이미지를 비교하는 중입니다 · 5~10초 소요"
    />
  );
}

function AnalysisEmpty() {
  return (
    <StudioEmptyState
      size="panel"
      icon="sparkle"
      title="분석 대기 중"
      description="두 이미지 업로드 후 좌측의 비교 분석 시작 을 눌러 주세요"
    />
  );
}

function AnalysisFallback({ summary }: { summary: string }) {
  return (
    <div
      style={{
        background: "var(--amber-soft)",
        border: "1px solid var(--amber)",
        borderRadius: "var(--radius)",
        padding: "12px 14px",
        fontSize: 12,
        color: "var(--amber-ink)",
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>분석 부분 실패</div>
      {summary || "비전 모델 응답을 파싱하지 못했습니다."}
    </div>
  );
}

function AnalysisFilled({ analysis }: { analysis: VisionCompareAnalysis }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 5축 막대 + 코멘트 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {AXIS_ORDER.map((axis) => (
          <AxisRow
            key={axis}
            label={AXIS_LABELS_KO[axis]}
            score={analysis.scores[axis]}
            comment={analysis.comments_ko[axis] || analysis.comments_en[axis]}
          />
        ))}
      </div>

      {/* 총평 */}
      {analysis.summary_ko && (
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            padding: "10px 12px",
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: ".15em",
              textTransform: "uppercase",
              marginBottom: 4,
              fontWeight: 600,
            }}
          >
            Summary
          </div>
          {analysis.summary_ko}
        </div>
      )}

      {/* 2026-04-26 v2.1 — Transform Prompt (B 만들기 t2i 변형 가이드) */}
      {(analysis.transform_prompt_ko || analysis.transform_prompt_en) && (
        <TransformPromptBox
          textKo={analysis.transform_prompt_ko}
          textEn={analysis.transform_prompt_en}
        />
      )}

      {/* 2026-04-26 v2.1 — Uncertain (비교 못한 영역) */}
      {(analysis.uncertain_ko || analysis.uncertain_en) && (
        <UncertainBox
          textKo={analysis.uncertain_ko}
          textEn={analysis.uncertain_en}
        />
      )}
    </div>
  );
}

function AxisRow({
  label,
  score,
  comment,
}: {
  label: string;
  score: number | null;
  comment: string;
}) {
  const pct = score ?? 0;
  // 점수 색상 — 80+ 초록, 60+ 앰버, 그 미만 회색
  const barColor =
    score === null
      ? "var(--ink-4)"
      : score >= 80
        ? "var(--green)"
        : score >= 60
          ? "var(--amber)"
          : "var(--ink-3)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>{label}</span>
        <span
          className="mono"
          style={{
            color: score === null ? "var(--ink-4)" : "var(--ink-2)",
            fontWeight: 600,
          }}
        >
          {score === null ? "—" : `${score}%`}
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--bg-2)",
          borderRadius: "var(--radius-full)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: barColor,
            transition: "width .35s ease",
          }}
        />
      </div>
      {comment && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--ink-3)",
            lineHeight: 1.5,
            paddingLeft: 2,
          }}
        >
          {comment}
        </div>
      )}
    </div>
  );
}
