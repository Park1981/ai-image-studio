/**
 * VideoResolutionCard — Video 페이지 좌패널의 영상 해상도 슬라이더 카드.
 *
 * 2026-05-06 (Codex finding 6): VideoLeftPanel.tsx (623줄) 의 인라인 sub-컴포넌트
 *   `VideoResolutionSlider` + `pickSpeedTone` 분리. 좌패널은 조립 역할만 남기고 카드 자체는
 *   본 파일이 단독 책임 — 슬라이더/속도 칩/원본 버튼/예상 해상도 라벨 전부 여기 박제.
 *
 * 책임:
 *   - 긴 변 512~1536 (step 128) 범위 선택 + 원본 비율 유지 (computeVideoResize 결과 prop)
 *   - 시간 가중치 (longerEdge² 근사) → 속도 칩 4단계 색상 매핑
 *   - 원본 크기 버튼 (clamp + step snap)
 *   - V5 토큰 cascade (.ais-size-card-v + .ais-video-res-card → coral 시그니처)
 *
 * 외부 의존: simplifyRatio (@/lib/video-size), VIDEO_LONGER_EDGE_* (useVideoStore).
 */

"use client";

import {
  VIDEO_LONGER_EDGE_MAX,
  VIDEO_LONGER_EDGE_MIN,
  VIDEO_LONGER_EDGE_STEP,
} from "@/stores/useVideoStore";
import { simplifyRatio } from "@/lib/video-size";

interface Props {
  longerEdge: number;
  setLongerEdge: (v: number) => void;
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** 부모 VideoLeftPanel 의 useMemo expected (단일 진실원 — slider/warn 모달 공유). */
  expected: { width: number; height: number };
}

export default function VideoResolutionCard({
  longerEdge,
  setLongerEdge,
  sourceWidth,
  sourceHeight,
  expected,
}: Props) {
  const hasSource = !!(sourceWidth && sourceHeight);
  // 시간 가중치 — 1536 기준 대비 (픽셀수 제곱 근사)
  const timeFactor = Math.pow(longerEdge / VIDEO_LONGER_EDGE_MAX, 2);
  const speed = pickSpeedTone(timeFactor);
  const ratio = hasSource ? simplifyRatio(sourceWidth!, sourceHeight!) : "—";

  /** 원본 해상도로 longerEdge 설정 — clamp + step 스냅 */
  const useOriginalSize = () => {
    if (!hasSource) return;
    const longer = Math.max(sourceWidth!, sourceHeight!);
    const clamped = Math.min(
      VIDEO_LONGER_EDGE_MAX,
      Math.max(VIDEO_LONGER_EDGE_MIN, longer),
    );
    const stepped =
      Math.round(clamped / VIDEO_LONGER_EDGE_STEP) * VIDEO_LONGER_EDGE_STEP;
    setLongerEdge(stepped);
  };

  return (
    // Phase 1.5.4 (V5 · 결정 D + E) — .ais-size-card-v + .ais-video-res-card cascade.
    // hasSource=false 시 opacity 만 동적 (V5 inline 잔여 — Codex 2차 허용 범위).
    <div
      className="ais-size-card-v ais-video-res-card"
      style={{
        opacity: hasSource ? 1 : 0.55,
        transition: "opacity .2s",
      }}
    >
      {/* size-header — Generate SizeCard 와 통일 (40x40 icon-box + 메타). */}
      <div className="ais-size-header">
        <span className="ais-size-header-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="3" width="18" height="18" rx="1.5" />
            <path d="M3 9h18M9 3v18" />
          </svg>
        </span>
        <span className="ais-size-header-meta">
          <span className="ais-size-header-title">영상 해상도</span>
          <span className="ais-size-header-chip">
            {hasSource
              ? `${expected.width}×${expected.height} · ${ratio}`
              : `긴 변 ${longerEdge}px`}
          </span>
        </span>
      </div>

      {/* 원본 + 속도 chip 묶음 — 헤더 아래 우측 정렬 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={useOriginalSize}
          disabled={!hasSource}
          title={
            hasSource
              ? `원본 크기로 (${Math.max(sourceWidth!, sourceHeight!)}px)`
              : "원본 이미지 업로드 후 사용 가능"
          }
          style={{
            all: "unset",
            cursor: hasSource ? "pointer" : "not-allowed",
            fontSize: 10.5,
            fontWeight: 600,
            padding: "3px 9px",
            borderRadius: "var(--radius-full)",
            border: "1px solid var(--line)",
            background: "var(--bg-2)",
            color: hasSource ? "var(--ink-2)" : "var(--ink-4)",
            transition: "all .15s",
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          📐 원본
        </button>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 9px",
            borderRadius: "var(--radius-full)",
            background: speed.bg,
            border: `1px solid ${speed.border}`,
            fontSize: 10.5,
            fontWeight: 600,
            color: speed.ink,
          }}
          title={`${longerEdge}px 긴 변 · 처리 속도 ${speed.label}`}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: speed.dot,
              flexShrink: 0,
            }}
          />
          {speed.label}
        </span>
      </div>
      <input
        type="range"
        min={VIDEO_LONGER_EDGE_MIN}
        max={VIDEO_LONGER_EDGE_MAX}
        step={VIDEO_LONGER_EDGE_STEP}
        value={longerEdge}
        disabled={!hasSource}
        onChange={(e) => setLongerEdge(Number(e.target.value))}
        style={{
          width: "100%",
          // V5 시그니처 (.ais-video-res-card → coral) cascade. 외부 사용처는 var(--accent) fallback.
          accentColor: "var(--ais-range-accent, var(--accent))",
          cursor: hasSource ? "pointer" : "not-allowed",
        }}
      />
      {/* 눈금 + 현재 값 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--ink-4)",
          marginTop: 2,
        }}
        className="mono"
      >
        <span>{VIDEO_LONGER_EDGE_MIN}</span>
        <span style={{ color: "var(--ink-2)", fontWeight: 600 }}>
          긴 변 {longerEdge}px
        </span>
        <span>{VIDEO_LONGER_EDGE_MAX}</span>
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: "var(--ink-3)",
          lineHeight: 1.5,
        }}
      >
        {hasSource ? (
          <>
            원본 <span className="mono">{sourceWidth}×{sourceHeight}</span>
            {" → "}
            출력{" "}
            <span
              className="mono"
              style={{ color: "var(--accent-ink)", fontWeight: 600 }}
            >
              {expected.width}×{expected.height}
            </span>{" "}
            <span style={{ color: "var(--ink-4)" }}>({ratio})</span>
          </>
        ) : (
          "원본 이미지를 업로드하면 예상 출력 해상도가 표시됩니다."
        )}
      </div>
    </div>
  );
}

/** 처리 속도 → 색상 톤 매핑 (오빠 피드백 — 추상 라벨 → 색상 chip).
 *  매우 빠름 = emerald · 빠름 = cyan · 표준 = amber · 고품질 = rose
 *  배경/테두리는 옅게, dot 만 진한 색 → 시각 노이즈 ↓ */
function pickSpeedTone(timeFactor: number): {
  label: string;
  bg: string;
  border: string;
  ink: string;
  dot: string;
} {
  if (timeFactor > 0.8) {
    return {
      label: "고품질",
      bg: "rgba(244,63,94,.08)",
      border: "rgba(244,63,94,.32)",
      ink: "#be123c",
      dot: "#f43f5e",
    };
  }
  if (timeFactor > 0.4) {
    return {
      label: "표준",
      bg: "rgba(245,158,11,.10)",
      border: "rgba(245,158,11,.32)",
      ink: "#b45309",
      dot: "#f59e0b",
    };
  }
  if (timeFactor > 0.18) {
    return {
      label: "빠름",
      bg: "rgba(6,182,212,.10)",
      border: "rgba(6,182,212,.32)",
      ink: "#0e7490",
      dot: "#06b6d4",
    };
  }
  return {
    label: "매우 빠름",
    bg: "rgba(34,197,94,.10)",
    border: "rgba(34,197,94,.32)",
    ink: "#15803d",
    dot: "#22c55e",
  };
}
