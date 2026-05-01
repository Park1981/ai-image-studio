/**
 * VideoLeftPanel — Video 페이지 좌측 입력 패널.
 *
 * 포함:
 *  - StudioModeHeader (Video Generate)
 *  - 원본 이미지 카드 (SourceImageCard)
 *  - 영상 지시 textarea (PromptHistoryPeek + 비우기)
 *  - VideoResolutionSlider (긴 변 픽셀 + 원본 비율 유지)
 *  - Lightning / Adult 토글
 *  - 16GB VRAM 주의 배너
 *  - Primary CTA (sticky · 처리 중 spinner + ETA)
 *
 * 2026-04-26: video/page.tsx 591줄 → 분해 step 1.
 *  - VideoResolutionSlider + simplifyRatio 도 같이 이동
 *  - Store 직접 구독 (useVideoInputs/useVideoRunning) → page 의 prop drilling 차단
 */

"use client";

import { useEffect, useRef, type RefObject } from "react";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import PromptModeRadio from "@/components/studio/PromptModeRadio";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import PromptToolsResults from "@/components/studio/prompt-tools/PromptToolsResults";
import { usePromptTools } from "@/hooks/usePromptTools";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import SourceImageCard from "@/components/studio/SourceImageCard";
import {
  StudioLeftPanel,
  StudioModeHeader,
} from "@/components/studio/StudioLayout";
import Icon from "@/components/ui/Icon";
import { Spinner, Toggle } from "@/components/ui/primitives";
import {
  computeVideoResize,
  useVideoInputs,
  useVideoRunning,
  VIDEO_LONGER_EDGE_MAX,
  VIDEO_LONGER_EDGE_MIN,
  VIDEO_LONGER_EDGE_STEP,
} from "@/stores/useVideoStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

interface Props {
  /** prompt textarea ref — useAutoGrowTextarea 훅이 부모에서 관리 */
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 영상 생성 트리거 (useVideoPipeline.generate) */
  onGenerate: () => void;
}

export default function VideoLeftPanel({
  promptTextareaRef,
  onGenerate,
}: Props) {
  const {
    sourceImage, sourceLabel, sourceWidth, sourceHeight, setSource,
    prompt, setPrompt,
    adult, setAdult,
    longerEdge, setLongerEdge,
    lightning, setLightning,
    skipUpgrade, setSkipUpgrade,
    promptMode, setPromptMode,
  } = useVideoInputs();
  const { running } = useVideoRunning();

  // Codex Phase 5 fix Medium — settings 의 ollamaModel override 를 도구로 전파.
  const ollamaModelForTools = useSettingsStore((s) => s.ollamaModel);

  // Phase 5 후속 (2026-05-01) — 프롬프트 도구 (번역/분리) state + 핸들러 통합 hook.
  const promptTools = usePromptTools({
    prompt,
    onPromptChange: setPrompt,
    ollamaModel: ollamaModelForTools,
    disabled: running,
  });

  // Phase 2 (2026-05-01) — settings 의 promptEnhanceMode 를 *마운트 시 1회만* store sync.
  // Codex Phase 4 리뷰 Medium #2 fix — session-only 정책 정합 (settings 변경은 다음 mount 부터 반영).
  const promptModeInitRef = useRef(false);
  useEffect(() => {
    if (promptModeInitRef.current) return;
    promptModeInitRef.current = true;
    setPromptMode(useSettingsStore.getState().promptEnhanceMode);
  }, [setPromptMode]);

  const handleSourceChange = (
    image: string,
    label: string,
    w: number,
    h: number,
  ) => {
    setSource(image, label, w, h);
    toast.success("이미지 업로드 완료", label.split(" · ")[0]);
  };
  const handleClearSource = () => {
    setSource(null);
    toast.info("이미지 해제됨");
  };

  const ctaDisabled = running || !sourceImage || !prompt.trim();

  return (
    <StudioLeftPanel>
      <StudioModeHeader
        title="Video Generate"
        description="원본 이미지와 영상 지시로 5초 MP4를 생성합니다."
        flowHref="/prompt-flow/video"
        flowLabel="영상 생성 프롬프트 흐름 보기"
      />

      {/* Primary CTA — sticky 상단 (Generate / Edit 와 통일) */}
      <div className="ais-cta-sticky-top">
        <button
          type="button"
          onClick={onGenerate}
          disabled={ctaDisabled}
          className="ais-cta-primary"
        >
          {running ? (
            <>
              <Spinner /> 처리 중…
            </>
          ) : (
            <>
              <Icon name="sparkle" size={15} />
              영상 생성
            </>
          )}
        </button>
        <div className="ais-cta-eta">
          평균 소요{" "}
          <span className="mono">{lightning ? "5~10분" : "25~40분"}</span> ·
          5초 영상 · 로컬 처리
        </div>
      </div>

      {/* ── 원본 이미지 ── */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            원본 이미지
          </label>
          <span className="mono ais-field-meta">
            {sourceWidth && sourceHeight
              ? `${sourceWidth}×${sourceHeight}`
              : "—"}
          </span>
        </div>
        <SourceImageCard
          sourceImage={sourceImage}
          sourceLabel={sourceLabel}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={handleSourceChange}
          onClear={handleClearSource}
          onError={(msg) => toast.error(msg)}
        />
      </div>

      {/* ── 영상 지시 prompt ── */}
      {/* 2026-05-01 (UX 통일): Generate/Edit/Compare 와 동일한 auto-grow textarea
       *  + 우하단 X 아이콘 박스 패턴. */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            영상 지시
          </label>
        </div>
        <div className="ais-prompt-shell">
          <PromptHistoryPeek mode="video" onSelect={(p) => setPrompt(p)} />
          <textarea
            ref={promptTextareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="어떤 움직임/카메라/분위기의 영상? 예: 느린 달리 인, 창가 빛 변화..."
            rows={3}
            className="ais-prompt-textarea"
          />
          {/* Phase 5 후속 (2026-05-01) — 도구 버튼 (번역/분리) textarea 안 우측. */}
          <PromptToolsButtons tools={promptTools} />
          {prompt.length > 0 && (
            <button
              type="button"
              onClick={() => setPrompt("")}
              aria-label="프롬프트 비우기"
              title="프롬프트 비우기"
              className="ais-prompt-clear-icon"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        {/* 번역/분리 결과 카드 — textarea 외부 아래에 펼침. */}
        <PromptToolsResults tools={promptTools} />
      </div>

      {/* AI 보정 카드 (Phase 2 후속 · 2026-05-01) — Generate/Edit 와 통일 패턴.
       *  Toggle + segmented 를 하나의 카드 wrap. 토글 OFF 면 segmented 미노출.
       *  Video 는 vision + gemma4 둘 다 우회 → ~15초 절약 (기본 OFF). */}
      <div className="ais-magic-prompt-card" data-active={!skipUpgrade}>
        <Toggle
          flat
          checked={!skipUpgrade}
          onChange={(v) => setSkipUpgrade(!v)}
          align="right"
          label="🪄 AI 프롬프트 보정"
          desc={
            skipUpgrade
              ? "OFF · 정제된 영문 프롬프트 그대로 (~15초 절약 · 기본)"
              : "ON · 이미지 분석 + 한국어 → 영문 정제"
          }
        />
        {!skipUpgrade && (
          <PromptModeRadio value={promptMode} onChange={setPromptMode} />
        )}
      </div>

      {/* ── 영상 해상도 슬라이더 ── */}
      <VideoResolutionSlider
        longerEdge={longerEdge}
        setLongerEdge={setLongerEdge}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
      />

      {/* ── 퀄리티 모드 토글 (Generate / Edit 와 통일 · 의미 반전)
       *  OFF=Lightning 빠름 (기본) / ON=💎 퀄리티 모드 (강화 옵션 · 얼굴 보존 우선)
       *  라벨 동적 분기 (2026-04-27 후속): 토글 상태가 곧 모드 명.
       *  store 의 lightning 의미는 그대로 (true=빠름) — UI 만 반전 (`!lightning`).
       */}
      <Toggle
        checked={!lightning}
        onChange={(v) => setLightning(!v)}
        align="right"
        label={lightning ? "⚡ 빠른 모드" : "💎 퀄리티 모드"}
        desc={
          lightning
            ? "Lightning 4-step · 약 5분 · 얼굴 변할 수 있음 (기본)"
            : "Full step · 약 20분+ · 얼굴 보존 우선"
        }
      />

      {/* 성인 모드 — align="right" (의미는 그대로 ON=켜짐 자연스러움) */}
      <Toggle
        checked={adult}
        onChange={setAdult}
        align="right"
        label="🔞 성인 모드"
        desc={
          adult
            ? "에로틱 모션 + NSFW LoRA 적용"
            : "SFW 프롬프트 · 얼굴 보존 안정"
        }
      />

    </StudioLeftPanel>
  );
}

/* ────────────────────────────────────────────────
   영상 해상도 슬라이더 (Video 전용 — 외부 노출 불필요)
   - 긴 변을 512~1536 (step 128) 범위로 선택
   - 원본 비율 유지: 예상 출력 해상도 실시간 계산
   - 이미지 없으면 disabled (비율 계산 불가)
   ──────────────────────────────────────────────── */
function VideoResolutionSlider({
  longerEdge,
  setLongerEdge,
  sourceWidth,
  sourceHeight,
}: {
  longerEdge: number;
  setLongerEdge: (v: number) => void;
  sourceWidth: number | null;
  sourceHeight: number | null;
}) {
  const hasSource = !!(sourceWidth && sourceHeight);
  const expected = hasSource
    ? computeVideoResize(sourceWidth!, sourceHeight!, longerEdge)
    : { width: 0, height: 0 };
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
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        opacity: hasSource ? 1 : 0.55,
        transition: "opacity .2s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <label
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}
        >
          영상 해상도
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* 원본 크기 버튼 — clamp + step snap (오빠 피드백) */}
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
          {/* 속도 chip — 색상 dot + 라벨 (시간 트레이드오프 시각화) */}
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
          accentColor: "var(--accent)",
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

/** 정수 비율 근사 — "16:9" / "3:4" 등 */
function simplifyRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
