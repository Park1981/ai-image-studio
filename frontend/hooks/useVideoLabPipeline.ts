/**
 * useVideoLabPipeline — /lab/video pipeline hook.
 */

"use client";

import { labVideoImageStream, labVideoPairStream } from "@/lib/api/lab";
import { consumePipelineStream } from "@/hooks/usePipelineStream";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import { useVideoLabStore } from "@/stores/useVideoLabStore";

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : "알 수 없는 오류";

const logLabVideoError = (scope: string, err: unknown) => {
  console.error(`[video-lab] ${scope}`, err);
};

export function useVideoLabPipeline(): {
  generate: () => Promise<void>;
  generatePair: () => Promise<void>;
} {
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
  const setLastError = useVideoLabStore((s) => s.setLastError);
  const setLastVideoRef = useVideoLabStore((s) => s.setLastVideoRef);
  const setLastPairRefs = useVideoLabStore((s) => s.setLastPairRefs);
  const resetPipeline = useVideoLabStore((s) => s.resetPipeline);

  const addItem = useHistoryStore((s) => s.add);
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  const comfyuiStatus = useProcessStore((s) => s.comfyui);

  const validateInput = () => {
    if (running) return;
    if (!sourceImage) {
      toast.warn("원본 이미지를 먼저 업로드해 주세요.");
      return false;
    }
    if (!prompt.trim()) {
      toast.warn("영상 지시를 입력해 주세요.");
      return false;
    }
    if (
      typeof sourceImage === "string" &&
      sourceImage.startsWith("mock-seed://")
    ) {
      toast.warn("Mock 결과 이미지는 Lab 영상 소스로 쓸 수 없어.");
      return false;
    }
    if (comfyuiStatus === "stopped") {
      toast.warn(
        "ComfyUI가 정지 상태입니다.",
        "Lab 영상 생성 시 backend가 ComfyUI 기동을 시도합니다.",
      );
    }
    return true;
  };

  const pushStageEvent = (e: {
    stageType: string;
    progress: number;
    stageLabel?: string;
    samplingStep?: number | null;
    samplingTotal?: number | null;
    type: string;
  } & Record<string, unknown>) => {
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
  };

  const generate = async () => {
    if (!validateInput()) return;
    usePromptHistoryStore.getState().add("video", prompt);
    const effectiveSkipUpgrade = skipUpgrade;

    setRunning(true);
    await consumePipelineStream(
      labVideoImageStream({
        sourceImage: sourceImage!,
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
          stage: pushStageEvent,
          done: (e) => {
            resetPipeline();
            setLastError(null);
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
        onIncomplete: () => {
          const message = "Lab 영상 스트림이 도중에 끊겼습니다.";
          setLastError(message);
          console.error("[video-lab] single stream incomplete");
          toast.warn(message);
        },
        onError: (err) => {
          const message = errorMessage(err);
          setLastError(message);
          logLabVideoError("single generation failed", err);
          toast.error("Lab 영상 생성 실패", message);
        },
        onFinally: resetPipeline,
      },
    );
  };

  const generatePair = async () => {
    if (!validateInput()) return;
    usePromptHistoryStore.getState().add("video", prompt);

    setRunning(true);
    await consumePipelineStream(
      labVideoPairStream({
        sourceImage: sourceImage!,
        prompt,
        presetId,
        longerEdge,
        lightning,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
        promptMode,
        pairMode: "shared_5beat",
        sulphurProfile: "official_i2v_v1",
      }),
      {
        on: {
          sampling: (e) =>
            setSampling(e.samplingStep ?? null, e.samplingTotal ?? null),
          stage: pushStageEvent,
          done: (e) => {
            resetPipeline();
            const wan = e.items.wan22;
            const sulphur = e.items["ltx-sulphur"];
            if (wan) addItem(wan);
            if (sulphur) addItem(sulphur);
            setLastPairRefs({
              wan22: wan?.imageRef ?? null,
              sulphur: sulphur?.imageRef ?? null,
            });

            if (e.failedModelId) {
              const modelError = e.errors?.[e.failedModelId];
              if (modelError) {
                setLastError(`${e.failedModelId}: ${modelError}`);
                console.error("[video-lab] compare partial failure", {
                  failedModelId: e.failedModelId,
                  errors: e.errors,
                });
              }
              toast.warn(
                "비교 일부 완료",
                `${e.failedModelId} 실패 · 완료된 결과만 표시합니다.`,
              );
            } else {
              setLastError(null);
              toast.success("비교 생성 완료", "Wan → Sulphur 순서로 생성됐습니다.");
            }
            if (Object.values(e.savedToHistory).some((saved) => !saved)) {
              toast.warn("일부 히스토리 DB 저장 실패");
            }
          },
        },
        onIncomplete: () => {
          const message = "Lab 비교 스트림이 도중에 끊겼습니다.";
          setLastError(message);
          console.error("[video-lab] compare stream incomplete");
          toast.warn(message);
        },
        onError: (err) => {
          const message = errorMessage(err);
          setLastError(message);
          logLabVideoError("compare generation failed", err);
          toast.error("Lab 비교 생성 실패", message);
        },
        onFinally: resetPipeline,
      },
    );
  };

  return { generate, generatePair };
}
