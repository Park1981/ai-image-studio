"use client";

import { useMemo, useState, type RefObject } from "react";
import ImageHistoryPickerDrawer from "@/components/studio/ImageHistoryPickerDrawer";
import LabFilesCheckBanner from "@/components/studio/lab/LabFilesCheckBanner";
import LabLoraOptionsBlock from "@/components/studio/lab/LabLoraOptionsBlock";
import ProcessingCTA from "@/components/studio/ProcessingCTA";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import PromptModeRadio from "@/components/studio/PromptModeRadio";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import PromptToolsResults from "@/components/studio/prompt-tools/PromptToolsResults";
import SourceImageCard from "@/components/studio/SourceImageCard";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import {
  StudioLeftPanel,
  StudioModeHeader,
} from "@/components/studio/StudioLayout";
import V5MotionCard from "@/components/studio/V5MotionCard";
import VideoResolutionCard from "@/components/studio/video/VideoResolutionCard";
import VideoSizeWarnModal from "@/components/studio/video/VideoSizeWarnModal";
import Icon from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/primitives";
import { usePromptModeInit } from "@/hooks/usePromptModeInit";
import { usePromptTools } from "@/hooks/usePromptTools";
import { shouldWarnVideoSize } from "@/lib/video-size";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import {
  computeVideoResize,
} from "@/stores/useVideoStore";
import {
  useVideoLabInputs,
  useVideoLabRunning,
} from "@/stores/useVideoLabStore";

interface Props {
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onGenerate: () => void;
}

export default function VideoLabLeftPanel({
  promptTextareaRef,
  onGenerate,
}: Props) {
  const {
    sourceImage,
    sourceLabel,
    sourceWidth,
    sourceHeight,
    setSource,
    prompt,
    setPrompt,
    longerEdge,
    setLongerEdge,
    lightning,
    setLightning,
    skipUpgrade,
    setSkipUpgrade,
    promptMode,
    setPromptMode,
  } = useVideoLabInputs();
  const { running, pipelineProgress, pipelineLabel } = useVideoLabRunning();
  const items = useHistoryStore((s) => s.items);
  const ollamaModelForTools = useSettingsStore((s) => s.ollamaModel);
  const [pendingAction, setPendingAction] = useState<"pair" | null>(null);
  const [imageHistoryOpen, setImageHistoryOpen] = useState(false);

  usePromptModeInit(setPromptMode);

  const isInvalidSource =
    typeof sourceImage === "string" && sourceImage.startsWith("mock-seed://");
  const ctaDisabled =
    running || !sourceImage || isInvalidSource || !prompt.trim();
  const promptTools = usePromptTools({
    prompt,
    onPromptChange: setPrompt,
    ollamaModel: ollamaModelForTools,
    disabled: running,
  });
  const expected = useMemo(() => {
    if (!sourceWidth || !sourceHeight) return { width: 0, height: 0 };
    return computeVideoResize(sourceWidth, sourceHeight, longerEdge);
  }, [sourceWidth, sourceHeight, longerEdge]);

  const warnOpen = pendingAction !== null;

  const runAction = () => onGenerate();

  const handleRunClick = () => {
    if (running || warnOpen || ctaDisabled) return;
    if (shouldWarnVideoSize(expected.width, expected.height)) {
      setPendingAction("pair");
      return;
    }
    runAction();
  };

  return (
    <>
      <VideoSizeWarnModal
        open={warnOpen}
        width={expected.width}
        height={expected.height}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) runAction();
        }}
      />
      <StudioLeftPanel>
        <StudioModeHeader
          titleKo="Lab 영상"
          titleEn="Video Lab"
          eyebrow="MODE · LAB"
          description="Sulphur LoRA 조합을 production과 분리해 검증합니다."
          flowHref="/prompt-flow/video"
          flowLabel="영상 생성 프롬프트 흐름 보기"
        />

        <div className="ais-cta-sticky-top">
          <ProcessingCTA
            onClick={handleRunClick}
            disabled={ctaDisabled}
            running={running}
            progress={pipelineProgress}
            idleLabel="Wan → Sulphur"
            runningLabel="비교 생성 중"
            subLabel={pipelineLabel || "LAB VIDEO PIPELINE"}
            icon="compare"
          />
        </div>

        <LabFilesCheckBanner />

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
            onChange={(image, label, w, h) => {
              setSource(image, label, w, h);
              toast.success("이미지 업로드 완료", label.split(" · ")[0]);
            }}
            onClear={() => {
              setSource(null);
              toast.info("이미지 해제됨");
            }}
            onError={(msg) => toast.error(msg)}
          />
        </div>

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
              placeholder="움직임/카메라/분위기를 입력"
              rows={3}
              className="ais-prompt-textarea"
            />
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
          <PromptToolsResults tools={promptTools} />
        </div>

        <V5MotionCard
          className="ais-toggle-card ais-sig-ai"
          data-active={!skipUpgrade}
          onClick={() => setSkipUpgrade(!skipUpgrade)}
          tooltip={
            skipUpgrade
              ? "OFF · 정제된 영문 프롬프트 그대로"
              : "ON · 이미지 분석 + 프롬프트 정제"
          }
        >
          <Toggle
            flat
            icon="stars"
            checked={!skipUpgrade}
            onChange={(v) => setSkipUpgrade(!v)}
            align="right"
            label="AI 프롬프트 보정"
          />
          {!skipUpgrade && (
            <PromptModeRadio
              value={promptMode}
              onChange={setPromptMode}
            />
          )}
        </V5MotionCard>

        <V5MotionCard
          className="ais-toggle-card ais-sig-fast"
          data-active={!lightning}
          onClick={() => setLightning(!lightning)}
          tooltip="ON 시 Lightning을 끄고 풀 디테일로 실행"
        >
          <Toggle
            flat
            icon="bolt"
            checked={!lightning}
            onChange={(v) => setLightning(!v)}
            align="right"
            label="퀄리티 모드"
          />
        </V5MotionCard>

        <LabLoraOptionsBlock />

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
