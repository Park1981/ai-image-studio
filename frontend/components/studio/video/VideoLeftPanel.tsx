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
import V5MotionCard from "@/components/studio/V5MotionCard";
import VideoModelSegment from "@/components/studio/video/VideoModelSegment";
import { VIDEO_MODEL_PRESETS } from "@/lib/model-presets";
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
    // Phase 5 (2026-05-03) — 영상 모델 선택 (Wan 2.2 / LTX 2.3)
    selectedVideoModel, setSelectedVideoModel,
  } = useVideoInputs();
  const { running } = useVideoRunning();

  // Phase 5 (2026-05-03) — 페이지 마운트 시 1회 settings.videoModel 로 sync.
  // setSelectedVideoModel 은 cross-store fan-out (옵션 A) 이라 settings 에서 store 로 회수만 필요.
  const videoModelInitRef = useRef(false);
  useEffect(() => {
    if (videoModelInitRef.current) return;
    videoModelInitRef.current = true;
    const persisted = useSettingsStore.getState().videoModel;
    if (persisted !== selectedVideoModel) {
      setSelectedVideoModel(persisted);
    }
    // selectedVideoModel 은 effect deps 에 안 넣음 — mount 시 1회만 init.
  }, [setSelectedVideoModel]); // eslint-disable-line react-hooks/exhaustive-deps

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
        titleKo="영상"
        titleEn="Video"
        eyebrow="MODE · VIDEO"
        description="원본 이미지와 영상 지시로 5초 MP4를 생성합니다."
        flowHref="/prompt-flow/video"
        flowLabel="영상 생성 프롬프트 흐름 보기"
      />

      {/* Primary CTA — sticky 상단 (Generate / Edit 와 통일).
       *  Phase 1.5.4 (결정 K) — 텍스트 영문 통일 (Render). shortcut 표시 X.
       *  Phase 5 follow-up 4 (2026-05-03 fix) — ETA description 제거 (Generate/Edit 와 통일). */}
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
              Render
            </>
          )}
        </button>
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

      {/* Phase 5 (2026-05-03 · spec §5.6) — 영상 모델 선택 세그먼트 (Wan 2.2 / LTX 2.3).
       *  2026-05-04: 사용자 피드백 — CTA 위 → 영상 지시 하단으로 이동 (Vision 페이지와 일관)
       *  + 헤더 ("영상 모델" + 현재 선택 모델명 meta) 추가 (Vision 카드 헤더와 통일). */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="violet" />
            영상 모델
          </label>
          <span className="mono ais-field-meta">
            {VIDEO_MODEL_PRESETS[selectedVideoModel]?.displayName ??
              selectedVideoModel}
          </span>
        </div>
        <VideoModelSegment
          value={selectedVideoModel}
          onChange={setSelectedVideoModel}
          disabled={running}
        />
      </div>

      {/* ── 카드 순서 (Phase 1.5.4 · 결정 B · 2026-05-02) ──
       *  옛: AI → 영상해상도 → 퀄리티 → 성인
       *  신: AI → 퀄리티 → 성인 → 영상해상도 (맨 아래) — 사이즈 카드와 페어 의도.
       *  속도 chip 4단계는 video-res-card *내부에* 유지 (결정 E). */}

      {/* AI 보정 카드 — Generate/Edit 와 통일 (V5 시그니처 .ais-sig-ai · violet/blue).
       *  카드 자체 onClick 으로 토글 작동 + tooltip + icon-box (stars) + desc 제거.
       *  Video 는 vision + gemma4 둘 다 우회 → ~15초 절약 (기본 OFF). */}
      <V5MotionCard
        className="ais-toggle-card ais-sig-ai"
        data-active={!skipUpgrade}
        onClick={() => setSkipUpgrade(!skipUpgrade)}
        tooltip={
          skipUpgrade
            ? "OFF · 정제된 영문 프롬프트 그대로 (~15초 절약)"
            : "ON · 이미지 분석 + 한국어 → 영문 정제"
        }
      >
        <Toggle
          flat
          icon="stars"
          checked={!skipUpgrade}
          onChange={(v) => setSkipUpgrade(!v)}
          align="right"
          label="🪄 AI 프롬프트 보정"
        />
        {!skipUpgrade && (
          <PromptModeRadio value={promptMode} onChange={setPromptMode} />
        )}
      </V5MotionCard>

      {/* 퀄리티 모드 — Generate/Edit 와 통일 (V5 시그니처 .ais-sig-fast · lime/cyan).
       *  라벨 "💎 퀄리티 모드" 고정 + onClick + tooltip + icon=bolt + desc 제거.
       *  카드 OFF = Lightning 빠른 모드 (기본) / ON = 퀄리티 모드 (얼굴 보존 우선). */}
      <V5MotionCard
        className="ais-toggle-card ais-sig-fast"
        data-active={!lightning}
        onClick={() => setLightning(!lightning)}
        tooltip="ON 시 Lightning 끄고 풀 디테일 · 약 4배 느림 (얼굴 보존 우선)"
      >
        <Toggle
          flat
          icon="bolt"
          checked={!lightning}
          onChange={(v) => setLightning(!v)}
          align="right"
          label="💎 퀄리티 모드"
        />
      </V5MotionCard>

      {/* 성인 모드 — V5 .ais-adult-card (crimson 시그니처 · Video 전용).
       *  Generate/Edit 패턴 통일 (onClick + tooltip + desc 제거).
       *  활성 시 aspect-ratio 16/9 자동 적용 (globals.css line 1066) — 인물 풀 노출.
       *  framer-motion layout 으로 16:9 변화 시 다른 카드 reflow spring 보간 (가장 큰 효과). */}
      <V5MotionCard
        className="ais-toggle-card ais-adult-card"
        data-active={adult}
        onClick={() => setAdult(!adult)}
        tooltip="ON 시 NSFW LoRA + 에로틱 모션 · OFF 는 SFW + 얼굴 보존"
      >
        <Toggle
          flat
          icon="flame"
          checked={adult}
          onChange={setAdult}
          align="right"
          label="🔞 성인 모드"
        />
      </V5MotionCard>

      {/* ── 영상 해상도 슬라이더 (맨 아래 · 결정 B + D) ──
       *  V5 .ais-size-card-v + .ais-video-res-card (coral 시그니처 · 사이즈 카드와 페어).
       *  속도 chip 4단계는 *내부에* 유지 (결정 E · v4 명시). */}
      <VideoResolutionSlider
        longerEdge={longerEdge}
        setLongerEdge={setLongerEdge}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
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
    // Phase 1.5.4 (V5 · 결정 D + E) — 옛 surface inline style → .ais-size-card-v.ais-video-res-card.
    // size-card-v 가 base (padding/blur/glass) + video-res-card 가 시그니처 var override (coral).
    // 속도 chip 4단계는 내부에 유지 (결정 E · 별도 카드 X).
    // hasSource=false 시 opacity 만 동적 (V5 시각 대상 inline 잔여 — Codex 2차 허용 범위).
    <div
      className="ais-size-card-v ais-video-res-card"
      style={{
        opacity: hasSource ? 1 : 0.55,
        transition: "opacity .2s",
      }}
    >
      {/* size-header 구조 (Generate SizeCard 와 통일 · 2026-05-03):
       *  40x40 사각 icon-box (coral 시그니처 cascade) + 메타 (제목 + 출력 사이즈 chip). */}
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

      {/* 원본 + 속도 chip 묶음 — 헤더 아래 별도 줄 우측 정렬 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          marginBottom: 8,
        }}
      >
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
          // V5 시그니처 (.ais-video-res-card → coral) cascade 활용. 외부 사용처는 fallback var(--accent) 유지.
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

/** 정수 비율 근사 — "16:9" / "3:4" 등 */
function simplifyRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}
