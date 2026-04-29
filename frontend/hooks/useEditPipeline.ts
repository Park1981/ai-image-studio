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
// v9 (2026-04-29 · Phase B.4): 옛 createReferenceTemplate 자동 호출 제거.
// 사후 promote 는 EditResultViewer 의 ActionBar → ReferencePromoteModal 로 이전됨.
import { cropBlobIfArea, dataUrlToBlob } from "@/lib/image-crop";
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
  // Phase 2 (2026-04-28): 수동 crop 영역 (있으면 reference 를 미리 crop 해서 전송)
  const referenceCropArea = useEditStore((s) => s.referenceCropArea);
  // v9 라이브러리 plan (2026-04-29 · Phase B.4): 라이브러리 픽 케이스 식별용.
  // 옛 v8 의 saveAsTemplate / templateName 자동 저장은 제거됨 (사후 ActionBar 로 이전).
  const pickedTemplateId = useEditStore((s) => s.pickedTemplateId);
  const pickedTemplateRef = useEditStore((s) => s.pickedTemplateRef);
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

    // Codex Phase 2 리뷰 결함 #3 fix: useReferenceImage=true 인데 referenceImage=null
    // 이면 (race / 직접 호출 등 CTA 가드 우회 시) meta 만 ON 으로 가서 백엔드 400.
    // → effectiveUseRef 로 한 곳에서 통일해 모든 reference 필드를 일관되게 OFF.
    const effectiveUseRef = useReferenceImage && !!referenceImage;

    // Phase 2 (2026-04-28): reference 가 있고 crop area 도 있으면 *클라이언트* 에서
    // 미리 crop 해서 cropped File 로 전송. area 없으면 원본 data URL 그대로.
    // crop 변환 실패 (canvas / toBlob) 시 사용자에게 toast + 진입 차단.
    let resolvedReferenceImage: string | File | undefined;
    if (effectiveUseRef && referenceImage) {
      if (referenceCropArea) {
        try {
          const original = await dataUrlToBlob(referenceImage);
          const cropped = await cropBlobIfArea(original, referenceCropArea);
          resolvedReferenceImage = new File([cropped], "reference-crop.png", {
            type: "image/png",
          });
        } catch (err) {
          toast.error(
            "참조 이미지 crop 실패",
            err instanceof Error ? err.message : "알 수 없는 오류",
          );
          return;
        }
      } else {
        resolvedReferenceImage = referenceImage;
      }
    }

    // v9 (2026-04-29 · Phase B.4): 옛 v8 자동 저장 스냅샷 제거.
    // 사용자가 결과 확인 후 ActionBar 의 📚 라이브러리 저장 버튼으로 명시 promote (Phase C).

    setRunning(true);
    await consumePipelineStream(
      editImageStream({
        sourceImage,
        prompt,
        lightning,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
        // effectiveUseRef 로 모든 reference 필드를 한꺼번에 게이트 — 백엔드 400 차단.
        useReferenceImage: effectiveUseRef,
        referenceImage: effectiveUseRef ? resolvedReferenceImage : undefined,
        referenceRole: effectiveUseRef ? effectiveRole : undefined,
        // v8 라이브러리 plan: 토글 OFF 면 stale picked 값 있어도 전송 X.
        // referenceRef 는 absolute URL 일 수 있으므로 백엔드 DB 저장 근거로 신뢰 X
        // (Codex 3차 리뷰 fix). referenceTemplateId 가 권위 있는 신뢰 키.
        referenceRef: effectiveUseRef
          ? (pickedTemplateRef ?? undefined)
          : undefined,
        referenceTemplateId: effectiveUseRef
          ? (pickedTemplateId ?? undefined)
          : undefined,
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
            // v9 (2026-04-29 · Phase B.4): 옛 자동 저장 호출 제거.
            // 사용자가 결과 확인 후 ActionBar 의 📚 라이브러리 저장 버튼 → POST /promote/{id}
            // (Phase C — ReferencePromoteModal + EditResultViewer 의 ActionBar 버튼).
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
