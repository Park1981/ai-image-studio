/**
 * useVideoLabPipeline — /lab/video pipeline hook.
 */

"use client";

import { labVideoImageStream } from "@/lib/api/lab";
import { consumePipelineStream } from "@/hooks/usePipelineStream";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import { useVideoLabStore } from "@/stores/useVideoLabStore";

export function useVideoLabPipeline(): { generate: () => Promise<void> } {
  const sourceImage = useVideoLabStore((s) => s.sourceImage);
  const prompt = useVideoLabStore((s) => s.prompt);
  const presetId = useVideoLabStore((s) => s.presetId);
  const activeLoraIds = useVideoLabStore((s) => s.activeLoraIds);
  const loraStrengths = useVideoLabStore((s) => s.loraStrengths);
  const longerEdge = useVideoLabStore((s) => s.longerEdge);
  const lightning = useVideoLabStore((s) => s.lightning);
  const skipUpgrade = useVideoLabStore((s) => s.skipUpgrade);
  const promptMode = useVideoLabStore((s) => s.promptMode);
  const running = useVideoLabStore((s) => s.running);
  const setRunning = useVideoLabStore((s) => s.setRunning);
  const setSampling = useVideoLabStore((s) => s.setSampling);
  const setPipelineProgress = useVideoLabStore((s) => s.setPipelineProgress);
  const pushStage = useVideoLabStore((s) => s.pushStage);
  const setLastVideoRef = useVideoLabStore((s) => s.setLastVideoRef);
  const resetPipeline = useVideoLabStore((s) => s.resetPipeline);

  const addItem = useHistoryStore((s) => s.add);
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  const comfyuiStatus = useProcessStore((s) => s.comfyui);

  const generate = async () => {
    if (running) return;
    if (!sourceImage) {
      toast.warn("원본 이미지를 먼저 업로드해 주세요.");
      return;
    }
    if (!prompt.trim()) {
      toast.warn("영상 지시를 입력해 주세요.");
      return;
    }
    if (
      typeof sourceImage === "string" &&
      sourceImage.startsWith("mock-seed://")
    ) {
      toast.warn("Mock 결과 이미지는 Lab 영상 소스로 쓸 수 없어.");
      return;
    }
    if (comfyuiStatus === "stopped") {
      toast.warn(
        "ComfyUI가 정지 상태입니다.",
        "Lab 영상 생성 시 backend가 ComfyUI 기동을 시도합니다.",
      );
    }

    usePromptHistoryStore.getState().add("video", prompt);
    const effectiveSkipUpgrade = skipUpgrade;

    setRunning(true);
    await consumePipelineStream(
      labVideoImageStream({
        sourceImage,
        prompt,
        presetId,
        activeLoraIds,
        loraStrengths,
        longerEdge,
        lightning,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
        preUpgradedPrompt: effectiveSkipUpgrade ? prompt : undefined,
        promptMode,
      }),
      {
        on: {
          sampling: (e) =>
            setSampling(e.samplingStep ?? null, e.samplingTotal ?? null),
          stage: (e) => {
            setPipelineProgress(e.progress, e.stageLabel);
            const {
              type: _discriminator,
              stageType,
              progress: _progress,
              stageLabel: _stageLabel,
              samplingStep: _ss,
              samplingTotal: _st,
              ...payload
            } = e;
            void _discriminator;
            void _progress;
            void _stageLabel;
            void _ss;
            void _st;
            const hasPayload = Object.keys(payload).length > 0;
            pushStage({
              type: stageType,
              label: e.stageLabel ?? "",
              progress: e.progress,
              ...(hasPayload ? { payload } : {}),
            });
          },
          done: (e) => {
            resetPipeline();
            addItem(e.item);
            setLastVideoRef(e.item.imageRef);
            toast.success(
              "Lab 영상 생성 완료",
              `${e.item.durationSec ?? "?"}초 · ${e.item.fps ?? "?"}fps`,
            );
            if (e.item.comfyError) {
              toast.error(
                "ComfyUI 오류",
                e.item.comfyError.slice(0, 160),
              );
            }
            if (!e.savedToHistory) {
              toast.warn("히스토리 DB 저장 실패");
            }
          },
        },
        onIncomplete: () =>
          toast.warn("Lab 영상 스트림이 도중에 끊겼습니다."),
        onError: (err) =>
          toast.error(
            "Lab 영상 생성 실패",
            err instanceof Error ? err.message : "알 수 없는 오류",
          ),
        onFinally: resetPipeline,
      },
    );
  };

  return { generate };
}
