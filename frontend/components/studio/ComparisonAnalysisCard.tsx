/**
 * ComparisonAnalysisCard - 비교 분석 결과 인라인 카드 (4-state).
 *
 * State:
 *  - disabled : sourceRef 없음 → "분석 불가" 안내 (옛 row)
 *  - loading  : 분석 중 → 스피너 + 라벨
 *  - empty    : sourceRef 있고 분석 안 함 → "분석" 버튼만
 *  - filled   : 분석 완료 → 종합 % + 3축 dot + [자세히] [재분석]
 *
 * /edit 페이지 Before/After 슬라이더 아래 +
 * ImageLightbox 메타 패널 안에서 재사용 (presentational · state X).
 * 클릭 시 ComparisonAnalysisModal 오픈은 부모가 관리 (onOpenDetail).
 *
 * 2026-05-02 디자인 V5 Phase 5 격상 + Codex 1차 fix:
 *  - **모든 state** className `.ais-comparison-card` + `data-state` 분기 (inline 잔여 0)
 *    - filled (default) → amber gradient 시그니처
 *    - empty/loading/disabled → surface (옛 톤 · 분석 결과 *있음* vs *없음* 시각 차별화)
 *  - 자식 inline → CSS (.ais-comp-label / .ais-comp-analyze-btn / .ais-comp-icon state 분기)
 *  - filled 자식 className `.ais-comp-icon / -dot / -overall / -sep / -axis / -spacer / -detail-btn / -refresh-btn`
 *  - score 숫자 제거 (시안 톤 — dot + 라벨만)
 *  - **a11y 보강** (Codex nit #3): ais-comp-axis 에 aria-label 명시 — 시각 X 사용자에게 정확 % + tone 전달
 *    예: "얼굴 92% — 일치" / "체형 64% — 보통" / "의상 미분석"
 */

"use client";

import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";
import {
  COMPARISON_OBJECT_SCENE_SLOTS,
  COMPARISON_PERSON_SLOTS,
  SLOT_LABELS_KO,
  type ComparisonAnalysis,
  type HistoryItem,
} from "@/lib/api/types";

export interface Props {
  item: HistoryItem;
  /** 분석 진행 중 여부 (useComparisonAnalysis 훅이 관리). */
  busy: boolean;
  /** 분석 트리거 (수동 클릭). */
  onAnalyze: () => void;
  /** "자세히" 클릭 → 모달 오픈. analysis 있을 때만 호출됨. */
  onOpenDetail: (analysis: ComparisonAnalysis) => void;
  /** "재분석" 클릭. analysis 있을 때만 호출됨. */
  onReanalyze: () => void;
}

type Tone = "green" | "amber" | "red" | "neutral";

/** 점수 → tone 매핑 (V5 data-tone CSS 분기용).
 *  임계: ≥80 green / 50-79 amber / <50 red / null neutral */
function scoreTone(score: number | null): Tone {
  if (score == null) return "neutral";
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
}

/** tone → 한글 라벨 (a11y aria-label · 스크린리더용). */
function toneKoLabel(tone: Tone): string {
  if (tone === "green") return "일치";
  if (tone === "amber") return "보통";
  if (tone === "red") return "낮음";
  return "미분석";
}

/** axis aria-label 조립 — "얼굴 92% — 일치" / "체형 미분석" 형태. */
function axisAriaLabel(label: string, score: number | null): string {
  if (score == null) return `${label} 미분석`;
  return `${label} ${score}% — ${toneKoLabel(scoreTone(score))}`;
}

export default function ComparisonAnalysisCard({
  item,
  busy,
  onAnalyze,
  onOpenDetail,
  onReanalyze,
}: Props) {
  const analysis = item.comparisonAnalysis;
  const hasSource = !!item.sourceRef;

  // disabled — sourceRef 없는 옛 row (최우선 분기)
  if (!hasSource) {
    return (
      <div className="ais-comparison-card" data-state="disabled" role="status">
        <span className="ais-comp-label">
          🔍 분석 불가 · 원본 이미지가 저장돼 있지 않은 옛 항목입니다
        </span>
      </div>
    );
  }

  // loading — 분석 진행 중
  if (busy) {
    return (
      <div className="ais-comparison-card" data-state="loading" role="status" aria-live="polite">
        {/* Spinner 기본 색(#fff)은 흰 배경에서 안 보임 → ink-2 로 오버라이드 (component prop · inline X) */}
        <Spinner size={13} color="var(--ink-2)" />
        <span className="ais-comp-label">분석 중… qwen2.5vl 5-10초</span>
      </div>
    );
  }

  // empty — sourceRef 있음 + 분석 미실행
  if (!analysis) {
    return (
      <div className="ais-comparison-card" data-state="empty">
        <span className="ais-comp-icon" aria-hidden>
          <Icon name="search" size={13} />
        </span>
        <span className="ais-comp-label">비교 분석</span>
        <button
          type="button"
          className="ais-comp-analyze-btn"
          onClick={onAnalyze}
        >
          분석
        </button>
      </div>
    );
  }

  // V5 filled — 분석 결과 있음 (.ais-comparison-card amber 시그니처)
  // v3 vs v1 분기: slots 있으면 도메인별 첫 3 슬롯, 없으면 옛 face_id/body_pose/attire
  const isV3 = !!analysis.slots && Object.keys(analysis.slots).length > 0;
  const previewAxes = isV3
    ? (analysis.domain === "person"
        ? COMPARISON_PERSON_SLOTS
        : COMPARISON_OBJECT_SCENE_SLOTS
      ).slice(0, 3)
    : null;

  const overallTone = scoreTone(analysis.overall);

  return (
    <div className="ais-comparison-card" data-state="filled">
      <span className="ais-comp-icon" aria-hidden>
        <Icon name="search" size={14} stroke={2.0} />
      </span>
      <span
        className="ais-comp-dot"
        data-tone={overallTone}
        aria-label={`전체 ${analysis.overall}% — ${toneKoLabel(overallTone)}`}
      />
      <span className="ais-comp-overall">{analysis.overall}% match</span>
      <span className="ais-comp-sep" aria-hidden>·</span>
      {isV3 && previewAxes ? (
        previewAxes.map((key) => {
          const entry = analysis.slots?.[key];
          const score = entry?.score ?? null;
          const tone = scoreTone(score);
          const label = SLOT_LABELS_KO[key]?.split("/")[0] ?? key;
          return (
            <span
              key={key}
              className="ais-comp-axis"
              aria-label={axisAriaLabel(label, score)}
            >
              <span className="ais-axis-dot" data-tone={tone} aria-hidden />
              {label}
            </span>
          );
        })
      ) : (
        <>
          <span
            className="ais-comp-axis"
            aria-label={axisAriaLabel("얼굴", analysis.scores?.face_id ?? null)}
          >
            <span
              className="ais-axis-dot"
              data-tone={scoreTone(analysis.scores?.face_id ?? null)}
              aria-hidden
            />
            얼굴
          </span>
          <span
            className="ais-comp-axis"
            aria-label={axisAriaLabel("체형", analysis.scores?.body_pose ?? null)}
          >
            <span
              className="ais-axis-dot"
              data-tone={scoreTone(analysis.scores?.body_pose ?? null)}
              aria-hidden
            />
            체형
          </span>
          <span
            className="ais-comp-axis"
            aria-label={axisAriaLabel("의상", analysis.scores?.attire ?? null)}
          >
            <span
              className="ais-axis-dot"
              data-tone={scoreTone(analysis.scores?.attire ?? null)}
              aria-hidden
            />
            의상
          </span>
        </>
      )}
      <span className="ais-comp-spacer" />
      <button
        type="button"
        className="ais-comp-detail-btn"
        onClick={() => onOpenDetail(analysis)}
      >
        자세히
      </button>
      <button
        type="button"
        className="ais-comp-refresh-btn"
        onClick={onReanalyze}
        title="재분석"
        aria-label="비교 분석 재실행"
      >
        <Icon name="refresh" size={13} />
      </button>
    </div>
  );
}
