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

import { editImageStream } from "@/lib/api/edit";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
import { consumePipelineStream } from "@/hooks/usePipelineStream";
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
  // Multi-reference (2026-04-27): 토글 OFF 면 모두 무관 — generate 안에서 게이트.
  const useReferenceImage = useEditStore((s) => s.useReferenceImage);
  const referenceImage = useEditStore((s) => s.referenceImage);
  const referenceRole = useEditStore((s) => s.referenceRole);
  const referenceRoleCustom = useEditStore((s) => s.referenceRoleCustom);
  // 실행 상태 setter
  const running = useEditStore((s) => s.running);
  const setRunning = useEditStore((s) => s.setRunning);
  const setSource = useEditStore((s) => s.setSource);
  const setSampling = useEditStore((s) => s.setSampling);
  const setPipelineProgress = useEditStore((s) => s.setPipelineProgress);
  const pushStage = useEditStore((s) => s.pushStage);
  const setEditVisionAnalysis = useEditStore((s) => s.setEditVisionAnalysis);
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

    // Multi-reference (2026-04-27): role 최종 문자열 결정.
    // "custom" + 자유 텍스트 → 텍스트 그대로 / "custom" + 빈 값 → undefined (role 명시 없음).
    // Codex Phase 1-3 통합 리뷰 Important #3 fix: 빈 custom 의 폴백을 의미 없는
    // "general" 로 보내는 대신 undefined 로 처리 → backend 의 build_reference_clause 가
    // 빈 문자열 반환 → SYSTEM_EDIT 옛 그대로 (multi-ref 효과 X · 일반 edit 흐름).
    const effectiveRole: string | undefined =
      referenceRole === "custom"
        ? referenceRoleCustom.trim() || undefined
        : referenceRole;

    setRunning(true);
    await consumePipelineStream(
      editImageStream({
        sourceImage,
        prompt,
        lightning,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
        // Multi-ref: 토글 OFF 면 reference 필드 모두 undefined → 옛 흐름 100% 동일.
        useReferenceImage,
        referenceImage: useReferenceImage ? referenceImage : undefined,
        referenceRole: useReferenceImage ? effectiveRole : undefined,
      }),
      {
        on: {
          sampling: (e) =>
            setSampling(e.samplingStep ?? null, e.samplingTotal ?? null),
          // Phase 4 (2026-04-27 진행 모달 store 통일 · 정리):
          //   step handler 제거 — 백엔드/lib/api 둘 다 step event 안 보냄 (transitional 종료).
          //   detail (description / finalPrompt / editVisionAnalysis) 은 stage payload
          //   에 흡수되어 stageHistory[].payload 로 들어가고 PipelineTimeline 이 사용.
          stage: (e) => {
            setPipelineProgress(e.progress, e.stageLabel);
            // 백엔드가 보낸 임의 payload 를 stageHistory 에 그대로 보관.
            // e.type 은 discriminator ("stage") · 백엔드 raw type 은 e.stageType.
            // stageType/progress/stageLabel/sampling* 외 필드 (description /
            // finalPrompt / finalPromptKo / provider / editVisionAnalysis 등) 가 payload.
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
            // Phase 1 호환: vision-analyze 완료 stage 의 editVisionAnalysis
            // 필드를 휘발 store 에도 별도 보관 (PIPELINE_DEFS edit 의 ctx 가 사용).
            const visionAnalysis = (
              payload as { editVisionAnalysis?: unknown }
            ).editVisionAnalysis;
            if (stageType === "vision-analyze" && visionAnalysis) {
              setEditVisionAnalysis(
                visionAnalysis as Parameters<typeof setEditVisionAnalysis>[0],
              );
            }
          },
          done: (e) => {
            resetPipeline();
            addItem(e.item);
            // sourceImage → backend 영구 sourceRef 로 교체 (dataURL → 절대 URL)
            if (e.item.sourceRef) {
              setSource(
                e.item.sourceRef,
                sourceLabel || e.item.label,
                e.item.width,
                e.item.height,
              );
            }
            onComplete(e.item.id);
            toast.success("수정 완료", e.item.label);
            if (e.item.comfyError) {
              toast.error(
                "ComfyUI 오류 (Mock 폴백 적용)",
                e.item.comfyError.slice(0, 160),
              );
            } else if (e.item.promptProvider === "fallback") {
              toast.warn("gemma4 업그레이드 실패", "Ollama 상태 확인 필요");
            }
            if (!e.savedToHistory) {
              toast.warn(
                "히스토리 DB 저장 실패",
                "결과는 화면에서 유지되지만 서버 재기동 후 사라질 수 있습니다.",
              );
            }
            // 자동 비교 분석 — silent=true → VRAM > 13GB 면 자동 skip
            if (
              autoCompareAnalysis &&
              e.item.mode === "edit" &&
              e.item.sourceRef &&
              !isComparisonBusy(e.item.id)
            ) {
              void analyzeComparison(e.item, { silent: true });
            }
          },
        },
        onIncomplete: () =>
          toast.warn(
            "수정 스트림이 도중에 끊겼습니다.",
            "백엔드 로그를 확인해 주세요. 결과는 저장되지 않았습니다.",
          ),
        onError: (err) =>
          toast.error(
            "수정 실패",
            err instanceof Error ? err.message : "알 수 없는 오류",
          ),
        // 어떤 종료 경로든 running 해제 보장 (UI 영구 잠금 방지)
        onFinally: resetPipeline,
      },
    );
  };

  return { generate };
}
