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
 */

"use client";

import type { CSSProperties } from "react";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";
import type { ComparisonAnalysis, HistoryItem } from "@/lib/api-client";

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
          style={btnStyle("primary")}
        >
          분석
        </button>
      </CardShell>
    );
  }

  // filled — 분석 결과 있음 (analysis 가 null-safe 하게 접근됨)
  return (
    <CardShell>
      <Icon name="search" size={13} style={{ color: "var(--ink-3)" }} />
      {/* 종합 점수 색상 도트 */}
      <Dot score={analysis.overall} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>
        {analysis.overall}% match
      </span>
      <span style={{ fontSize: 11, color: "var(--ink-4)" }}>·</span>
      {/* 인라인에선 face/body/attire 3축만 (background/intent_fidelity 는 모달에서 보임) */}
      <AxisDot label="얼굴" v={analysis.scores.face_id} />
      <AxisDot label="체형" v={analysis.scores.body_pose} />
      <AxisDot label="의상" v={analysis.scores.attire} />
      {/* 남은 공간 채우기 */}
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={() => onOpenDetail(analysis)}
        style={btnStyle("secondary")}
      >
        자세히
      </button>
      {/* ghost 재분석 버튼 (아이콘만) */}
      <button
        type="button"
        onClick={onReanalyze}
        style={btnStyle("ghost")}
        title="재분석"
      >
        <Icon name="refresh" size={11} />
      </button>
    </CardShell>
  );
}

/* ── 내부 서브 컴포넌트 ── */

/** 카드 공통 래퍼 — 디자인 토큰 기반 */
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

/**
 * 점수 → 색상 변환.
 * 임계: ≥80 녹 / 50-79 노 / <50 적 / null → 회색
 * CSS var 미정의 시 hex fallback 사용.
 */
function scoreColor(score: number | null): string {
  if (score == null) return "var(--ink-4)";
  if (score >= 80) return "var(--green-ink, #2f8a3a)";
  if (score >= 50) return "var(--amber-ink, #b8860b)";
  return "var(--red-ink, #c0392b)";
}

/** 색상 채워진 원형 도트 */
function Dot({ score }: { score: number | null }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: scoreColor(score),
        // 미묘한 인셋 테두리로 입체감
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.1)",
        flexShrink: 0,
      }}
    />
  );
}

/** 축 라벨 + 도트 + 점수 숫자 세트. score null 이면 "—" 표시 */
function AxisDot({ label, v }: { label: string; v: number | null }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: "var(--ink-3)",
      }}
    >
      {label}
      <Dot score={v} />
      <span className="mono" style={{ fontSize: 10.5, color: scoreColor(v) }}>
        {v != null ? v : "—"}
      </span>
    </span>
  );
}

/** 버튼 스타일 팩토리 */
function btnStyle(kind: "primary" | "secondary" | "ghost"): CSSProperties {
  // CSS all:unset 은 TypeScript 에서 "unset" 리터럴 타입으로 명시 필요
  const base: CSSProperties = {
    all: "unset" as CSSProperties["all"],
    cursor: "pointer",
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: "var(--radius-sm)",
    transition: "background .12s",
    // 버튼 기본 flex 정렬
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (kind === "primary") {
    return {
      ...base,
      background: "var(--accent)",
      color: "#fff",
      fontWeight: 600,
    };
  }
  if (kind === "secondary") {
    return {
      ...base,
      background: "var(--bg-2)",
      color: "var(--ink-2)",
      border: "1px solid var(--line)",
    };
  }
  // ghost — 아이콘 전용, 패딩 좁게
  return {
    ...base,
    background: "transparent",
    color: "var(--ink-3)",
    padding: "4px 6px",
  };
}
