/**
 * CompareAnalysisPanel — /vision/compare 우 하단 분석 결과.
 * 2026-04-27 (C2-P1-1): vision/compare/page.tsx 분해 — 페이지에서 추출.
 *
 * 헤더 (5축 비교 분석 라벨 + 종합 점수 chip) + 본문 분기:
 *   - running: 로딩 상태
 *   - !analysis: 빈 상태
 *   - analysis.fallback: amber 폴백 카드
 *   - 정상: AxisRow 5개 + 총평 + transform_prompt + uncertain
 *
 * 2026-05-02 디자인 V5 Phase 7 격상:
 *  - 외곽 inline → className `.ais-compare-analysis-card` (surface + border + radius-card + padding 16 + flex column gap 14)
 *  - 헤더 → `.ais-cac-header` + `.ais-cac-title` + `.ais-cac-overall-chip` (violet gradient + violet text)
 *  - AxisRow → `.ais-axis-row` + `-head` + `-label` + `-score` + `-bar` + `-fill[data-tone]` + `-comment`
 *  - Summary 박스 → `.ais-cac-summary` + `.ais-cac-eyebrow`
 *  - Transform/Uncertain → CompareExtraBoxes V5 격상 (CompareExtraBoxes.tsx)
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

/** 점수 → tone 매핑 (V5 .ais-axis-fill[data-tone] CSS 분기용).
 *  임계: ≥80 green / ≥60 amber / <60 또는 null gray */
function scoreTone(score: number | null): "green" | "amber" | "gray" {
  if (score == null) return "gray";
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "gray";
}

export default function CompareAnalysisPanel({ running, analysis }: Props) {
  return (
    <div className="ais-compare-analysis-card">
      <div className="ais-cac-header">
        <div className="ais-cac-title">
          <Icon name="grid" size={13} />
          5축 비교 분석
        </div>
        {analysis && !analysis.fallback && (
          <div className="ais-cac-overall-chip">종합 {analysis.overall}%</div>
        )}
      </div>

      <div className="ais-cac-body">
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
    <div className="ais-cac-fallback">
      <div className="ais-cac-fallback-title">분석 부분 실패</div>
      {summary || "비전 모델 응답을 파싱하지 못했습니다."}
    </div>
  );
}

function AnalysisFilled({ analysis }: { analysis: VisionCompareAnalysis }) {
  return (
    <div className="ais-cac-filled">
      {/* 5축 막대 + 코멘트 */}
      <div className="ais-axis-rows">
        {AXIS_ORDER.map((axis) => (
          <AxisRow
            key={axis}
            label={AXIS_LABELS_KO[axis]}
            score={analysis.scores[axis]}
            comment={analysis.comments_ko[axis] || analysis.comments_en[axis]}
          />
        ))}
      </div>

      {/* 총평 (5축 종합) */}
      {analysis.summary_ko && (
        <div className="ais-cac-summary">
          <div className="ais-cac-eyebrow">SUMMARY</div>
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
  const tone = scoreTone(score);
  return (
    <div className="ais-axis-row">
      <div className="ais-axis-row-head">
        <span className="ais-axis-label">{label}</span>
        <span className="ais-axis-score">
          {score === null ? "—" : `${score}%`}
        </span>
      </div>
      <div className="ais-axis-bar">
        <div
          className="ais-axis-fill"
          data-tone={tone}
          style={{ width: `${pct}%` }}
          aria-label={`${label} ${score === null ? "분석 안 됨" : score + "%"}`}
        />
      </div>
      {comment && <div className="ais-axis-comment">{comment}</div>}
    </div>
  );
}
