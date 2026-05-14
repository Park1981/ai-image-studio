/**
 * VideoLeftPanel — Video 페이지 좌측 입력 패널.
 *
 * 포함:
 *  - StudioModeHeader (Video Generate)
 *  - 원본 이미지 카드 (SourceImageCard)
 *  - 영상 지시 textarea (PromptHistoryPeek + 비우기)
 *  - VideoResolutionCard (긴 변 픽셀 + 원본 비율 유지 · 2026-05-06 분리)
 *  - Lightning / Adult 토글
 *  - 16GB VRAM 주의 배너
 *  - Primary CTA (sticky · 처리 중 spinner + ETA)
 *
 * 2026-04-26: video/page.tsx 591줄 → 분해 step 1.
 *  - Store 직접 구독 (useVideoInputs/useVideoRunning) → page 의 prop drilling 차단
 *
 * 2026-05-06 (Codex finding 6): 영상 해상도 카드 분리 → 좌패널은 조립 역할만 유지.
 */

"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import ImageHistoryPickerDrawer from "@/components/studio/ImageHistoryPickerDrawer";
import PromptModeRadio from "@/components/studio/PromptModeRadio";
import ProcessingCTA from "@/components/studio/ProcessingCTA";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import PromptToolsResults from "@/components/studio/prompt-tools/PromptToolsResults";
import { usePromptModeInit } from "@/hooks/usePromptModeInit";
import { usePromptTools } from "@/hooks/usePromptTools";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import SourceImageCard from "@/components/studio/SourceImageCard";
import {
  StudioLeftPanel,
  StudioModeHeader,
} from "@/components/studio/StudioLayout";
import V5MotionCard from "@/components/studio/V5MotionCard";
import VideoModelSegment from "@/components/studio/video/VideoModelSegment";
import VideoResolutionCard from "@/components/studio/video/VideoResolutionCard";
import VideoAutoNsfwCard from "@/components/studio/video/VideoAutoNsfwCard";
import { AnimatePresence, motion } from "framer-motion";
import { USE_MOCK } from "@/lib/api/client";
import { VIDEO_MODEL_PRESETS } from "@/lib/model-presets";
import Icon from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/primitives";
import {
  computeVideoResize,
  useVideoInputs,
  useVideoRunning,
} from "@/stores/useVideoStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import VideoSizeWarnModal from "@/components/studio/video/VideoSizeWarnModal";
import { shouldWarnVideoSize } from "@/lib/video-size";

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
  const { running, pipelineProgress, pipelineLabel } = useVideoRunning();
  const items = useHistoryStore((s) => s.items);

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

  // spec 2026-05-12 v1.1 — 자동 NSFW 시나리오 (adult ON 일 때만 노출)
  const autoNsfwEnabled = useSettingsStore((s) => s.autoNsfwEnabled);
  const nsfwIntensity = useSettingsStore((s) => s.nsfwIntensity);
  const setAutoNsfwEnabled = useSettingsStore((s) => s.setAutoNsfwEnabled);
  const setNsfwIntensity = useSettingsStore((s) => s.setNsfwIntensity);
  const ollamaStatus = useProcessStore((s) => s.ollama);

  // spec 2026-05-13 v1.2 — adult OFF + persisted autoNsfwEnabled=true race 차단.
  // ComfyUI 는 backend 가 자동 기동하므로 CTA 에서는 Ollama(자동 NSFW 전용)만 사전 차단.
  const effectiveAutoNsfw = adult && autoNsfwEnabled;
  const promptRequired = !effectiveAutoNsfw;
  const externalDepsReady =
    USE_MOCK || !effectiveAutoNsfw || ollamaStatus === "running";
  const isInvalidSource =
    typeof sourceImage === "string" && sourceImage.startsWith("mock-seed://");
  const ctaDisabled =
    running ||
    !sourceImage ||
    isInvalidSource ||
    (promptRequired && !prompt.trim()) ||
    !externalDepsReady;

  // Phase 5 후속 (2026-05-01) — 프롬프트 도구 (번역/분리) state + 핸들러 통합 hook.
  const promptTools = usePromptTools({
    prompt,
    onPromptChange: setPrompt,
    ollamaModel: ollamaModelForTools,
    disabled: running || effectiveAutoNsfw,
  });

  // Phase 2 (2026-05-01 · 2026-05-06 hook 추출) — session-only 정책 sync.
  // 자세한 배경은 `hooks/usePromptModeInit.ts` 주석.
  usePromptModeInit(setPromptMode);

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

  // 단일 진실원 — slider + warn modal 둘 다 이 expected 사용 (불일치 race 차단).
  // useMemo: sourceWidth/sourceHeight/longerEdge 변동 시만 재계산.
  const expected = useMemo(() => {
    if (!sourceWidth || !sourceHeight) return { width: 0, height: 0 };
    return computeVideoResize(sourceWidth, sourceHeight, longerEdge);
  }, [sourceWidth, sourceHeight, longerEdge]);

  // 큰 사이즈 경고 모달 노출 state.
  const [warnOpen, setWarnOpen] = useState(false);
  const [imageHistoryOpen, setImageHistoryOpen] = useState(false);

  /**
   * Render CTA 클릭 — 사이즈 임계 충족 시 경고 모달, 미만이면 즉시 onGenerate.
   * 방어 가드: running / warnOpen / ctaDisabled 중 하나라도 truthy 면 early return.
   */
  const handleCtaClick = () => {
    if (running || warnOpen || ctaDisabled) return;

    if (shouldWarnVideoSize(expected.width, expected.height)) {
      setWarnOpen(true);
      return;
    }

    onGenerate();
  };

  /** 모달 [그대로 진행] — 닫고 → 즉시 onGenerate (모달 잔류 프레임 ↓). */
  const handleConfirmWarn = () => {
    setWarnOpen(false);
    onGenerate();
  };

  /** 모달 [취소] / ESC / overlay — 닫기만, generate 미호출. */
  const handleCancelWarn = () => {
    setWarnOpen(false);
  };

  return (
    <>
      <VideoSizeWarnModal
        open={warnOpen}
        width={expected.width}
        height={expected.height}
        onCancel={handleCancelWarn}
        onConfirm={handleConfirmWarn}
      />
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
        <ProcessingCTA
          onClick={handleCtaClick}
          disabled={ctaDisabled}
          running={running}
          progress={pipelineProgress}
          idleLabel="Render"
          runningLabel="영상 생성 중"
          subLabel={pipelineLabel || "VIDEO PIPELINE"}
          icon="sparkle"
        />
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
          <button
            type="button"
            onClick={() => setImageHistoryOpen(true)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
            }}
          >
            <Icon name="grid" size={11} /> 이미지 히스토리
          </button>
        </div>
        <ImageHistoryPickerDrawer
          open={imageHistoryOpen}
          items={items}
          selectedImageRef={sourceImage}
          onClose={() => setImageHistoryOpen(false)}
          onPick={(it) => {
            setSource(
              it.imageRef,
              `${it.label} · ${it.width}×${it.height}`,
              it.width,
              it.height,
            );
            toast.info("원본으로 지정", it.label);
          }}
        />
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
          {!effectiveAutoNsfw && (
            <PromptHistoryPeek mode="video" onSelect={(p) => setPrompt(p)} />
          )}
          <textarea
            ref={promptTextareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="어떤 움직임/카메라/분위기의 영상? 예: 느린 달리 인, 창가 빛 변화..."
            rows={3}
            className="ais-prompt-textarea"
            disabled={effectiveAutoNsfw}
          />
          {/* Phase 5 후속 (2026-05-01) — 도구 버튼 (번역/분리) textarea 안 우측. */}
          {!effectiveAutoNsfw && <PromptToolsButtons tools={promptTools} />}
          {prompt.length > 0 && !effectiveAutoNsfw && (
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
        {!effectiveAutoNsfw && <PromptToolsResults tools={promptTools} />}
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
        data-active={!skipUpgrade || effectiveAutoNsfw}
        onClick={
          // spec 2026-05-13 v1.2 — effectiveAutoNsfw 면 클릭 차단
          effectiveAutoNsfw ? undefined : () => setSkipUpgrade(!skipUpgrade)
        }
        tooltip={
          effectiveAutoNsfw
            ? "자동 NSFW 모드는 항상 AI 보강을 사용합니다"
            : skipUpgrade
              ? "OFF · 정제된 영문 프롬프트 그대로 (~15초 절약)"
              : "ON · 이미지 분석 + 한국어 → 영문 정제"
        }
      >
        <Toggle
          flat
          icon="stars"
          checked={!skipUpgrade || effectiveAutoNsfw}
          onChange={(v) => setSkipUpgrade(!v)}
          align="right"
          label="🪄 AI 프롬프트 보정"
          disabled={effectiveAutoNsfw}
        />
        {(!skipUpgrade || effectiveAutoNsfw) && (
          <PromptModeRadio
            value={promptMode}
            onChange={setPromptMode}
            disabled={effectiveAutoNsfw}
          />
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
        {/* spec 2026-05-12 v1.1 §4.9 (2026-05-12 fix: adult 카드 안 nested 통합).
         *  adult ON 일 때만 노출. 토글 + 강도 슬라이더 (1: 은근 / 2: 옷벗음 / 3: 옷벗음+애무).
         *  VideoAutoNsfwCard 의 outer section onClick stopPropagation 으로
         *  부모 V5MotionCard onClick (adult 토글) bubble 차단. */}
        <AnimatePresence initial={false}>
          {adult && (
            <motion.div
              key="auto-nsfw-card"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: "hidden", marginTop: 8 }}
            >
              <VideoAutoNsfwCard
                autoNsfwEnabled={autoNsfwEnabled}
                nsfwIntensity={nsfwIntensity}
                onToggle={setAutoNsfwEnabled}
                onIntensityChange={setNsfwIntensity}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </V5MotionCard>

      {/* ── 영상 해상도 슬라이더 (맨 아래 · 결정 B + D) ──
       *  2026-05-06 (Codex finding 6): VideoResolutionCard 로 분리.
       *  V5 .ais-size-card-v + .ais-video-res-card (coral 시그니처 · 사이즈 카드와 페어). */}
      <VideoResolutionCard
        longerEdge={longerEdge}
        setLongerEdge={setLongerEdge}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
        expected={expected}
      />

      </StudioLeftPanel>
    </>
  );
}
