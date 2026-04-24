/**
 * useVideoPipeline — LTX-2.3 i2v 페이지의 5-step 파이프라인 훅.
 * 2026-04-24 · V6.
 *
 * Edit 의 useEditPipeline 과 구조 동일. onComplete(mp4Ref) 로 부모에게
 * 완료 영상 URL 전달 + 히스토리에 add.
 */

"use client";

import { videoImageStream } from "@/lib/api-client";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import { useVideoStore } from "@/stores/useVideoStore";

export interface UseVideoPipelineOptions {
  /** 새 영상 완료 시 부모가 추가 처리할 때 (예: lastVideoRef 외 추가 로컬 상태) */
  onComplete?: (videoRef: string) => void;
}

export interface UseVideoPipeline {
  generate: () => Promise<void>;
}

export function useVideoPipeline(
  opts: UseVideoPipelineOptions = {},
): UseVideoPipeline {
  // 입력
  const sourceImage = useVideoStore((s) => s.sourceImage);
  const prompt = useVideoStore((s) => s.prompt);
  const adult = useVideoStore((s) => s.adult);
  const longerEdge = useVideoStore((s) => s.longerEdge);
  const lightning = useVideoStore((s) => s.lightning);
  // 실행 상태
  const running = useVideoStore((s) => s.running);
  const setRunning = useVideoStore((s) => s.setRunning);
  const setStep = useVideoStore((s) => s.setStep);
  const recordStepDetail = useVideoStore((s) => s.recordStepDetail);
  const setSampling = useVideoStore((s) => s.setSampling);
  const setPipelineProgress = useVideoStore((s) => s.setPipelineProgress);
  const setLastVideoRef = useVideoStore((s) => s.setLastVideoRef);
  const resetPipeline = useVideoStore((s) => s.resetPipeline);
  // 히스토리
  const addItem = useHistoryStore((s) => s.add);
  // 설정
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  // 프로세스 상태
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
    if (comfyuiStatus === "stopped") {
      toast.warn(
        "ComfyUI가 정지 상태입니다.",
        "설정에서 시작하실 수 있고, Mock은 그대로 동작합니다.",
      );
    }

    setRunning(true);
    let completed = false;
    try {
      for await (const evt of videoImageStream({
        sourceImage,
        prompt,
        adult,
        longerEdge,
        lightning,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
      })) {
        if (evt.type === "sampling") {
          setSampling(evt.samplingStep ?? null, evt.samplingTotal ?? null);
          continue;
        }
        if (evt.type === "step") {
          setStep(evt.step, evt.done);
          if (!evt.done) {
            recordStepDetail({
              n: evt.step,
              startedAt: Date.now(),
              doneAt: null,
            });
          } else {
            // done 시 startedAt 안 넘김 → store merge 가 기존 startedAt 보존.
            recordStepDetail({
              n: evt.step,
              doneAt: Date.now(),
              description: evt.description,
              finalPrompt: evt.finalPrompt,
              finalPromptKo: evt.finalPromptKo,
              provider: evt.provider,
            });
          }
        } else if (evt.type === "stage") {
          setPipelineProgress(evt.progress, evt.stageLabel);
        } else if (evt.type === "done") {
          resetPipeline();
          addItem(evt.item);
          setLastVideoRef(evt.item.imageRef);
          opts.onComplete?.(evt.item.imageRef);
          toast.success(
            "영상 생성 완료",
            `${evt.item.durationSec ?? "?"}초 · ${evt.item.fps ?? "?"}fps`,
          );
          if (evt.item.comfyError) {
            toast.error(
              "ComfyUI 오류 (Mock 폴백 적용)",
              evt.item.comfyError.slice(0, 160),
            );
          } else if (evt.item.promptProvider === "fallback") {
            toast.warn("gemma4 업그레이드 실패", "Ollama 상태 확인 필요");
          }
          if (!evt.savedToHistory) {
            toast.warn(
              "히스토리 DB 저장 실패",
              "영상은 화면에서 유지되지만 서버 재기동 후 사라질 수 있습니다.",
            );
          }
          completed = true;
          return;
        }
      }
      // generator 가 done 없이 끝남 — 비정상 종료
      if (!completed) {
        toast.warn(
          "영상 스트림이 도중에 끊겼습니다.",
          "백엔드 로그를 확인해 주세요. 결과는 저장되지 않았습니다.",
        );
      }
    } catch (err) {
      toast.error(
        "영상 생성 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
    } finally {
      // 어떤 종료 경로든 running 해제 보장 (UI 영구 잠금 방지)
      resetPipeline();
    }
  };

  return { generate };
}
