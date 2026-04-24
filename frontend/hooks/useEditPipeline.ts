/**
 * useEditPipeline — Edit 페이지의 4단계 파이프라인 실행 로직 캡슐화.
 * 2026-04-23 Opus F6: edit/page.tsx 에서 handleGenerate (~77줄) 을 훅으로 이동.
 *
 * 반환:
 *   - generate(): [수정 생성] 진입점. 조건 체크 + editImageStream 소비 + 토스트.
 *   - setAfterId: 훅이 새 결과 완료 시 부모에게 after 지정을 넘기기 위해 외부 setter 를 받음.
 *
 * 훅 내부에서 다음 스토어 구독:
 *   useEditStore · useSettingsStore · useHistoryStore · useToastStore(toast).
 */

"use client";

import { editImageStream } from "@/lib/api-client";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
import { useEditStore } from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

export interface UseEditPipelineOptions {
  /** 새 수정 완료 시 후속 Before/After 매칭용 afterId 세터 (페이지 로컬 state) */
  onComplete: (newItemId: string) => void;
}

export interface UseEditPipeline {
  generate: () => Promise<void>;
}

export function useEditPipeline({
  onComplete,
}: UseEditPipelineOptions): UseEditPipeline {
  // 입력값
  const sourceImage = useEditStore((s) => s.sourceImage);
  const sourceLabel = useEditStore((s) => s.sourceLabel);
  const prompt = useEditStore((s) => s.prompt);
  const lightning = useEditStore((s) => s.lightning);
  // 실행 상태 setter
  const running = useEditStore((s) => s.running);
  const setRunning = useEditStore((s) => s.setRunning);
  const setSource = useEditStore((s) => s.setSource);
  const setStep = useEditStore((s) => s.setStep);
  const recordStepDetail = useEditStore((s) => s.recordStepDetail);
  const setSampling = useEditStore((s) => s.setSampling);
  const setPipelineProgress = useEditStore((s) => s.setPipelineProgress);
  const resetPipeline = useEditStore((s) => s.resetPipeline);
  // 히스토리
  const addItem = useHistoryStore((s) => s.add);
  // 설정
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  const autoCompareAnalysis = useSettingsStore((s) => s.autoCompareAnalysis);
  const { analyze: analyzeComparison, isBusy: isComparisonBusy } =
    useComparisonAnalysis();

  const generate = async () => {
    if (running) return;
    if (!sourceImage) {
      toast.warn("원본 이미지를 먼저 업로드해 주세요.");
      return;
    }
    if (!prompt.trim()) {
      toast.warn("수정 지시를 입력해 주세요.");
      return;
    }

    setRunning(true);
    let completed = false;
    try {
      for await (const evt of editImageStream({
        sourceImage,
        prompt,
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
            // (이전엔 startedAt: Date.now() 가 머지에서 덮어써져 elapsed=0 이었음)
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
          // sourceImage 를 backend 영구 sourceRef 로 교체 (dataURL → 절대 URL)
          // → 이후 BeforeAfter 슬라이더의 매칭 조건 (afterItem.sourceRef === sourceImage)
          //   이 정확하게 동작. 옛 row 와도 동일 비교 가능.
          if (evt.item.sourceRef) {
            setSource(
              evt.item.sourceRef,
              sourceLabel || evt.item.label,
              evt.item.width,
              evt.item.height,
            );
          }
          onComplete(evt.item.id);
          toast.success("수정 완료", evt.item.label);
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
              "결과는 화면에서 유지되지만 서버 재기동 후 사라질 수 있습니다.",
            );
          }
          // 자동 비교 분석 — 토글 ON + edit 모드 + sourceRef 있음 + busy 아님 조건 모두 만족 시
          // void 호출로 본 흐름(resetPipeline/onComplete) 차단 X, 백그라운드 비동기 실행
          // silent=true → VRAM > 13GB 시 useComparisonAnalysis 가 자동 skip + 짧은 토스트
          if (
            autoCompareAnalysis &&
            evt.item.mode === "edit" &&
            evt.item.sourceRef &&
            !isComparisonBusy(evt.item.id)
          ) {
            void analyzeComparison(evt.item, { silent: true });
          }
          completed = true;
          return;
        }
      }
      // generator 가 done 없이 끝남 — 비정상 종료
      if (!completed) {
        toast.warn(
          "수정 스트림이 도중에 끊겼습니다.",
          "백엔드 로그를 확인해 주세요. 결과는 저장되지 않았습니다.",
        );
      }
    } catch (err) {
      toast.error(
        "수정 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
    } finally {
      // 어떤 종료 경로든 running 해제 보장 (UI 영구 잠금 방지)
      resetPipeline();
    }
  };

  return { generate };
}
