/**
 * useVisionPipeline — Vision Analyzer 페이지의 실행 로직 캡슐화.
 * 2026-04-24 · C4.
 *
 * 반환:
 *   - analyze(): [분석] 버튼 진입점. 조건 체크 + analyzeImage + store 업데이트 + 토스트.
 *   - analyzing: useVisionStore.running 프록시 (호출처 편의용).
 *
 * 훅 내부 구독:
 *   useVisionStore · useSettingsStore · useProcessStore · useToastStore(toast).
 */

"use client";

import { analyzeImage } from "@/lib/api-client";
import { resizeImageToThumbnail } from "@/lib/image-actions";
import { useProcessStore } from "@/stores/useProcessStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import { useVisionStore, type VisionEntry } from "@/stores/useVisionStore";

export interface UseVisionPipeline {
  analyze: () => Promise<void>;
  analyzing: boolean;
}

function makeEntryId(): string {
  return `vis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useVisionPipeline(): UseVisionPipeline {
  // 입력
  const currentImage = useVisionStore((s) => s.currentImage);
  const currentLabel = useVisionStore((s) => s.currentLabel);
  const currentWidth = useVisionStore((s) => s.currentWidth);
  const currentHeight = useVisionStore((s) => s.currentHeight);
  const running = useVisionStore((s) => s.running);
  const setRunning = useVisionStore((s) => s.setRunning);
  const setResult = useVisionStore((s) => s.setResult);
  const addEntry = useVisionStore((s) => s.addEntry);

  // 설정
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);

  // 프로세스 상태 (Ollama 정지 경고용)
  const ollamaStatus = useProcessStore((s) => s.ollama);

  const analyze = async () => {
    if (running) return;
    if (!currentImage) {
      toast.warn("이미지를 먼저 업로드해줘");
      return;
    }
    if (ollamaStatus === "stopped") {
      toast.warn(
        "Ollama 정지 상태",
        "설정에서 시작해도 되고, Mock 은 그대로 돌아가.",
      );
    }

    setRunning(true);
    try {
      const result = await analyzeImage(currentImage, {
        visionModel: visionModelSel,
        ollamaModel: ollamaModelSel,
      });

      setResult(result.en, result.ko);

      // 썸네일 리사이즈 — localStorage 용량 방어 (원본 dataURL 은 수 MB, 썸네일은 수십 KB)
      // 실패 시 원본 그대로 사용 (히스토리는 유지, 용량은 MAX 건수 상한으로 방어).
      const thumbnailRef = await resizeImageToThumbnail(currentImage);

      // fallback=true 면 entry 에도 en="" 저장되지만 히스토리는 기록함
      // (사용자가 "이때 Ollama 가 맛이 갔었구나" 를 알 수 있도록)
      const entry: VisionEntry = {
        id: makeEntryId(),
        imageRef: thumbnailRef,
        thumbLabel: currentLabel,
        en: result.en,
        ko: result.ko,
        createdAt: Date.now(),
        visionModel: visionModelSel,
        width: result.width || currentWidth || 0,
        height: result.height || currentHeight || 0,
      };
      addEntry(entry);

      if (result.fallback) {
        toast.error(
          "Vision 분석 실패",
          "Ollama 호출이 실패했어. 상태 확인 후 다시 시도해줘.",
        );
      } else if (result.ko === null) {
        toast.warn(
          "번역만 실패",
          "영문 결과는 정상이야. 한글 탭은 비어있어.",
        );
      } else {
        toast.success("Vision 분석 완료", `${result.en.length} chars · EN/KO`);
      }
    } catch (err) {
      toast.error(
        "Vision 분석 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
    } finally {
      setRunning(false);
    }
  };

  return { analyze, analyzing: running };
}
