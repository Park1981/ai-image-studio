/**
 * useVideoPipeline — LTX-2.3 i2v 페이지의 5-step 파이프라인 훅.
 * 2026-04-24 · V6.
 *
 * Edit 의 useEditPipeline 과 구조 동일. onComplete(mp4Ref) 로 부모에게
 * 완료 영상 URL 전달 + 히스토리에 add.
 */

"use client";

import { videoImageStream } from "@/lib/api/video";
import { USE_MOCK } from "@/lib/api/client";
import { consumePipelineStream } from "@/hooks/usePipelineStream";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
// 2026-04-30 (Phase 1 Task 0 · plan 2026-04-30-prompt-snippets-library.md):
// usePromptHistoryStore 가 모든 모드의 canonical source.
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";
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
  const skipUpgrade = useVideoStore((s) => s.skipUpgrade);
  const promptMode = useVideoStore((s) => s.promptMode);
  // Phase 4 (2026-05-03) — 영상 모델 선택 (Wan 2.2 / LTX 2.3)
  const selectedVideoModel = useVideoStore((s) => s.selectedVideoModel);
  // 실행 상태
  const running = useVideoStore((s) => s.running);
  const setRunning = useVideoStore((s) => s.setRunning);
  const setSampling = useVideoStore((s) => s.setSampling);
  const setPipelineProgress = useVideoStore((s) => s.setPipelineProgress);
  const pushStage = useVideoStore((s) => s.pushStage);
  const setLastVideoRef = useVideoStore((s) => s.setLastVideoRef);
  const resetPipeline = useVideoStore((s) => s.resetPipeline);
  // 히스토리
  const addItem = useHistoryStore((s) => s.add);
  // 설정
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  // spec 2026-05-12 v1.1 — 자동 NSFW 시나리오
  const autoNsfwEnabled = useSettingsStore((s) => s.autoNsfwEnabled);
  const nsfwIntensity = useSettingsStore((s) => s.nsfwIntensity);
  // 프로세스 상태
  const comfyuiStatus = useProcessStore((s) => s.comfyui);
  const ollamaStatus = useProcessStore((s) => s.ollama);

  const generate = async () => {
    if (running) return;
    if (!sourceImage) {
      toast.warn("원본 이미지를 먼저 업로드해 주세요.");
      return;
    }
    // spec 2026-05-12 v1.1 — adult && autoNsfwEnabled 단일 게이트 (race 차단)
    // adult OFF 면 VideoAutoNsfwCard 가 안 렌더되지만 settings store persist 로
    // autoNsfwEnabled=true 가 유령처럼 살아있을 수 있음 → effective 게이트 단일 진실원으로 일원화.
    const effectiveAutoNsfw = adult && autoNsfwEnabled;
    // spec 2026-05-12 v1.1 §4.10 — effectiveAutoNsfw 면 빈 prompt 허용
    // (vision + gemma4-un 이 이미지 분석 후 자율 시나리오 작성)
    if (!effectiveAutoNsfw && !prompt.trim()) {
      toast.warn("영상 지시를 입력해 주세요.");
      return;
    }
    if (effectiveAutoNsfw && !USE_MOCK && ollamaStatus === "stopped") {
      toast.warn(
        "Ollama가 정지 상태입니다.",
        "자동 NSFW는 vision + gemma4 (Ollama)가 필요합니다. 설정에서 시작해 주세요.",
      );
      return;
    }
    if (comfyuiStatus === "stopped") {
      toast.warn(
        "ComfyUI가 정지 상태입니다.",
        "설정에서 시작하실 수 있고, Mock은 그대로 동작합니다.",
      );
    }

    // 2026-04-30 (Phase 1 Task 0): prompt history 단일 source 에 등록.
    usePromptHistoryStore.getState().add("video", prompt);

    // spec 2026-05-12 v1.1 §5.7 — skipUpgrade 3-layer 방어 Layer 1
    // effectiveAutoNsfw 면 vision + gemma4 가 자율 시나리오 작성해야 하므로 skipUpgrade 강제 OFF.
    const effectiveSkipUpgrade = effectiveAutoNsfw ? false : skipUpgrade;

    setRunning(true);
    await consumePipelineStream(
      videoImageStream({
        sourceImage,
        prompt,
        adult,
        autoNsfw: effectiveAutoNsfw ? true : undefined,
        nsfwIntensity: effectiveAutoNsfw ? nsfwIntensity : undefined,
        longerEdge,
        lightning,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
        // skipUpgrade ON: 사용자가 정제된 영문 프롬프트 직접 입력 — vision + gemma4 우회.
        // autoNsfwEnabled 일 때는 강제 OFF → preUpgradedPrompt 미전송 (vision/gemma4 진행).
        preUpgradedPrompt: effectiveSkipUpgrade ? prompt : undefined,
        // Phase 2 (2026-05-01) — gemma4 보강 모드 (정밀 시 motion/camera/preserve 해석 깊어짐).
        promptMode,
        // Phase 4 (2026-05-03) — 영상 모델 선택 (Wan 2.2 / LTX 2.3)
        modelId: selectedVideoModel,
      }),
      {
        on: {
          sampling: (e) =>
            setSampling(e.samplingStep ?? null, e.samplingTotal ?? null),
          // Phase 4 (2026-04-27 진행 모달 store 통일 · 정리):
          //   step handler 제거 — 백엔드/lib/api 둘 다 step event 안 보냄 (transitional 종료).
          //   detail (description / finalPrompt / finalPromptKo / provider) 은
          //   stage payload 에 흡수되어 stageHistory[].payload 로 들어가고
          //   PipelineTimeline 이 사용.
          stage: (e) => {
            setPipelineProgress(e.progress, e.stageLabel);
            // 백엔드가 보낸 임의 payload 를 stageHistory 에 그대로 보관.
            // e.type 은 discriminator ("stage") · 백엔드 raw type 은 e.stageType.
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
            opts.onComplete?.(e.item.imageRef);
            toast.success(
              "영상 생성 완료",
              `${e.item.durationSec ?? "?"}초 · ${e.item.fps ?? "?"}fps`,
            );
            if (e.item.comfyError) {
              toast.error(
                "ComfyUI 오류 (Mock 폴백 적용)",
                e.item.comfyError.slice(0, 160),
              );
            } else if (e.item.promptProvider === "fallback-precise-failed") {
              // Phase 2 (2026-05-01) — 정밀 보강 실패 별도 분기
              toast.warn(
                "정밀 보강 실패",
                "원본 프롬프트로 생성됐어요. 빠른 모드로 다시 시도해 보세요.",
              );
            } else if (e.item.promptProvider === "fallback") {
              toast.warn("gemma4 업그레이드 실패", "Ollama 상태 확인 필요");
            }
            if (!e.savedToHistory) {
              toast.warn(
                "히스토리 DB 저장 실패",
                "영상은 화면에서 유지되지만 서버 재기동 후 사라질 수 있습니다.",
              );
            }
          },
        },
        onIncomplete: () =>
          toast.warn(
            "영상 스트림이 도중에 끊겼습니다.",
            "백엔드 로그를 확인해 주세요. 결과는 저장되지 않았습니다.",
          ),
        onError: (err) =>
          toast.error(
            "영상 생성 실패",
            err instanceof Error ? err.message : "알 수 없는 오류",
          ),
        onFinally: resetPipeline,
      },
    );
  };

  return { generate };
}
