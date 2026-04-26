/**
 * Edit Mode Page — Zustand 스토어 + ComfyUI Edit 파이프라인.
 *
 * 2026-04-26: 646줄 → 분해 (Generate 패턴 동일).
 *  - EditLeftPanel (입력) → components/studio/edit/EditLeftPanel.tsx
 *  - EditResultViewer (BeforeAfter) → components/studio/edit/EditResultViewer.tsx
 *  - EditRightPanel (결과+히스토리) → components/studio/edit/EditRightPanel.tsx
 *  - useEditInputs/useEditRunning 그룹 selectors
 *  - useAutoCloseModal / useAutoGrowTextarea 공용 훅
 *
 * Page 책임 (남은 것):
 *  - StudioPage shell + AppHeader + StudioWorkspace 조립
 *  - 모달 마운트 (Progress / ImageLightbox / ComparisonAnalysisModal)
 *  - 진입 시 1회 effect (Lightning 기본값 + prompt clear)
 *  - page-level state: lightboxSrc / afterId / comparisonModalOpen
 *  - 파이프라인 훅 (useEditPipeline) 보유 — onComplete 시 afterId 지정
 */

"use client";

import { useEffect, useRef, useState } from "react";
import AppHeader from "@/components/chrome/AppHeader";
import ComparisonAnalysisModal from "@/components/studio/ComparisonAnalysisModal";
import EditLeftPanel from "@/components/studio/edit/EditLeftPanel";
import EditRightPanel from "@/components/studio/edit/EditRightPanel";
import ImageLightbox from "@/components/studio/ImageLightbox";
import ProgressModal from "@/components/studio/ProgressModal";
import {
  StudioPage,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import { useAutoCloseModal } from "@/hooks/useAutoCloseModal";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { useEditPipeline } from "@/hooks/useEditPipeline";
import { downloadImage, filenameFromRef } from "@/lib/image-actions";
import {
  useEditInputs,
  useEditRunning,
  useEditStore,
} from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

export default function EditPage() {
  /* ── store ── */
  const { sourceImage, prompt, setPrompt, lightning, setLightning } =
    useEditInputs();
  const { running } = useEditRunning();
  const lightningByDefault = useSettingsStore((s) => s.lightningByDefault);
  const items = useHistoryStore((s) => s.items);

  /* ── page-level state ── */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [comparisonModalOpen, setComparisonModalOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useAutoCloseModal(running);

  /* ── 파이프라인 훅 — 새 결과 완료 시 afterId 지정 ── */
  const pipeline = useEditPipeline({
    onComplete: (id) => setAfterId(id),
  });

  /* ── afterItem (Lightbox 메타용) ── */
  const editResults = items.filter((x) => x.mode === "edit");
  const afterItem = afterId
    ? editResults.find((x) => x.id === afterId)
    : undefined;

  /* ── source 동기화: afterItem.sourceRef 가 현재 sourceImage 와 다르면 afterId 정리 ──
     렌더 직후 sync state 정리 — 시각 selection 일관성 (Zustand setter 는 외부 구독자도
     리렌더시키므로 useEffect 로 지연 호출이 필요. cascading render 1단계는 의도된 트레이드오프). */
  useEffect(() => {
    if (afterItem && afterItem.sourceRef !== sourceImage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAfterId(null);
    }
  }, [sourceImage, afterItem]);

  /* ── afterId 전환 시 비교 슬라이더를 중앙(50)으로 리셋 ── */
  useEffect(() => {
    if (afterId) useEditStore.getState().setCompareX(50);
  }, [afterId]);

  /* ── 진입 시 1회 effect ── */
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (lightningByDefault && !lightning) setLightning(true);
  }, [lightningByDefault, lightning, setLightning]);

  const promptClearedRef = useRef(false);
  useEffect(() => {
    if (promptClearedRef.current) return;
    promptClearedRef.current = true;
    setPrompt("");
  }, [setPrompt]);

  /* ── prompt textarea auto-grow ref (LeftPanel 로 전달) ── */
  const promptTextareaRef = useAutoGrowTextarea(prompt);

  return (
    <StudioPage>
      {progressOpen && (
        <ProgressModal mode="edit" onClose={() => setProgressOpen(false)} />
      )}
      {comparisonModalOpen && afterItem?.comparisonAnalysis && (
        <ComparisonAnalysisModal
          item={afterItem}
          analysis={afterItem.comparisonAnalysis}
          onClose={() => setComparisonModalOpen(false)}
        />
      )}
      <ImageLightbox
        src={lightboxSrc}
        item={afterItem}
        alt={afterItem?.label}
        filename={
          afterItem
            ? filenameFromRef(
                afterItem.imageRef,
                `ais-edit-${afterItem.id}.png`,
              )
            : undefined
        }
        onClose={() => setLightboxSrc(null)}
        onDownload={() => {
          if (afterItem) {
            downloadImage(
              afterItem.imageRef,
              filenameFromRef(
                afterItem.imageRef,
                `ais-edit-${afterItem.id}.png`,
              ),
            );
          }
        }}
        onUseAsSource={
          afterItem
            ? () => {
                // Lightbox 에서 "원본으로" — 연속 수정 플로우
                useEditStore
                  .getState()
                  .setSource(
                    afterItem.imageRef,
                    `${afterItem.label} · ${afterItem.width}×${afterItem.height}`,
                    afterItem.width,
                    afterItem.height,
                  );
                setAfterId(null);
                toast.info("원본으로 지정", afterItem.label);
              }
            : undefined
        }
      />
      <AppHeader />

      <StudioWorkspace>
        <EditLeftPanel
          promptTextareaRef={promptTextareaRef}
          onGenerate={pipeline.generate}
        />
        <EditRightPanel
          afterId={afterId}
          setAfterId={setAfterId}
          onLightboxOpen={setLightboxSrc}
          onComparisonModalOpen={() => setComparisonModalOpen(true)}
        />
      </StudioWorkspace>
    </StudioPage>
  );
}
