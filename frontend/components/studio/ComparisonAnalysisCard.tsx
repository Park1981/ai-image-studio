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
 * 2026-05-02 디자인 V5 Phase 5 격상:
 *  - filled state 시각 — amber gradient bg + 점 + mono 13px overall + 3축 dot 색 매칭 (data-tone)
 *  - className `.ais-comparison-card` + 자식 `.ais-comp-*`
 *  - score 숫자 제거 (시안 톤 — dot + 라벨만 · 자세히 모달에서 정확 % 확인)
 *  - disabled / loading / empty state 는 옛 CardShell 시각 유지 (시안 X · 호환 우선)
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

/**
 * 점수 → tone 매핑 (V5 data-tone CSS 분기용).
 * 임계: ≥80 green / 50-79 amber / <50 red / null neutral
 */
function scoreTone(score: number | null): "green" | "amber" | "red" | "neutral" {
  if (score == null) return "neutral";
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
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
      <CardShell>
        <span style={{ fontSize: 11.5, color: "var(--ink-4)", lineHeight: 1.5 }}>
          🔍 분석 불가 · 원본 이미지가 저장돼 있지 않은 옛 항목입니다
        </span>
      </CardShell>
    );
  }

  // loading — 분석 진행 중
  if (busy) {
    return (
      <CardShell>
        {/* Spinner 기본 색(#fff)은 흰 배경에서 안 보임 → ink-2 로 오버라이드 */}
        <Spinner size={13} color="var(--ink-2)" />
        <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
          분석 중… qwen2.5vl 5-10초
        </span>
      </CardShell>
    );
  }

  // empty — sourceRef 있음 + 분석 미실행
  if (!analysis) {
    return (
      <CardShell>
        <Icon name="search" size={13} style={{ color: "var(--ink-3)" }} />
        <span style={{ fontSize: 12, color: "var(--ink-3)", flex: 1 }}>
          비교 분석
        </span>
        <button
          type="button"
          onClick={onAnalyze}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 11,
            padding: "4px 10px",
            borderRadius: "var(--radius-sm)",
            transition: "background .12s",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          분석
        </button>
      </CardShell>
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
    <div className="ais-comparison-card">
      <span className="ais-comp-icon" aria-hidden>
        <Icon name="search" size={14} stroke={2.0} />
      </span>
      <span className="ais-comp-dot" data-tone={overallTone} aria-hidden />
      <span className="ais-comp-overall">{analysis.overall}% match</span>
      <span className="ais-comp-sep">·</span>
      {isV3 && previewAxes ? (
        previewAxes.map((key) => {
          const entry = analysis.slots?.[key];
          const tone = scoreTone(entry?.score ?? null);
          const label = SLOT_LABELS_KO[key]?.split("/")[0] ?? key;
          return (
            <span key={key} className="ais-comp-axis">
              <span className="ais-axis-dot" data-tone={tone} aria-hidden />
              {label}
            </span>
          );
        })
      ) : (
        <>
          <span className="ais-comp-axis">
            <span
              className="ais-axis-dot"
              data-tone={scoreTone(analysis.scores?.face_id ?? null)}
              aria-hidden
            />
            얼굴
          </span>
          <span className="ais-comp-axis">
            <span
              className="ais-axis-dot"
              data-tone={scoreTone(analysis.scores?.body_pose ?? null)}
              aria-hidden
            />
            체형
          </span>
          <span className="ais-comp-axis">
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
      >
        <Icon name="refresh" size={13} />
      </button>
    </div>
  );
}

/* ── 내부 서브 컴포넌트 ── */

/** 카드 공통 래퍼 — disabled/loading/empty state 용 (옛 CardShell · V5 호환 유지) */
function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        boxShadow: "var(--shadow-sm)",
        // 모바일 좁을 때 줄바꿈 허용
        flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}
