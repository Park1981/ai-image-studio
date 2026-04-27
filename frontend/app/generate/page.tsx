/**
 * Generate Mode Page — Zustand 스토어 + ComfyUI 파이프라인.
 *
 * 2026-04-26 (task #5): 940줄 → 100줄 분해.
 *  - GenerateLeftPanel (입력 영역) → components/studio/generate/GenerateLeftPanel.tsx
 *  - GenerateRightPanel (결과/히스토리) → components/studio/generate/GenerateRightPanel.tsx
 *  - 인라인 style 30+ → globals.css `.ais-*` token class
 *  - useGenerateInputs/useGenerateRunning 그룹 selectors
 *  - useAutoCloseModal / useAutoGrowTextarea 공용 hooks
 *
 * Page 책임 (남은 것):
 *  - StudioPage shell + AppHeader + StudioWorkspace 조립
 *  - 모달 (Progress / UpgradeConfirm / ImageLightbox) 마운트
 *  - 진입 시 1회 effect (Lightning 기본값 + prompt clear)
 *  - lightboxSrc page-level state 한 개
 *  - 파이프라인 훅 보유
 */

"use client";

import { useEffect, useRef, useState } from "react";
import AppHeader from "@/components/chrome/AppHeader";
import GenerateLeftPanel from "@/components/studio/generate/GenerateLeftPanel";
import GenerateRightPanel from "@/components/studio/generate/GenerateRightPanel";
import ImageLightbox from "@/components/studio/ImageLightbox";
import ProgressModal from "@/components/studio/ProgressModal";
import {
  StudioPage,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import UpgradeConfirmModal from "@/components/studio/UpgradeConfirmModal";
import { downloadImage, filenameFromRef } from "@/lib/image-actions";
import { useAutoCloseModal } from "@/hooks/useAutoCloseModal";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { useGeneratePipeline } from "@/hooks/useGeneratePipeline";
import {
  useGenerateInputs,
  useGenerateRunning,
} from "@/stores/useGenerateStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

export default function GeneratePage() {
  /* ── store ── */
  const { prompt, setPrompt, lightning, applyLightning } = useGenerateInputs();
  const { generating } = useGenerateRunning();
  const lightningByDefault = useSettingsStore((s) => s.lightningByDefault);

  // selectedItem 은 lightbox 메타용 — RightPanel 도 별도 구독
  const items = useHistoryStore((s) => s.items);
  const selectedId = useHistoryStore((s) => s.selectedId);
  const selectedItem = items.find(
    (i) => i.mode === "generate" && i.id === selectedId,
  );

  /* ── 파이프라인 (SSE + 업그레이드 + 조사) ── */
  const pipeline = useGeneratePipeline();

  /* ── Lightbox / Progress 모달 ── */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [progressOpen, setProgressOpen] = useAutoCloseModal(generating);

  /* ── 진입 시 1회 effect ── */
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (lightningByDefault && !lightning) applyLightning(true);
  }, [lightningByDefault, lightning, applyLightning]);

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
        <ProgressModal
          mode="generate"
          onClose={() => setProgressOpen(false)}
        />
      )}
      <UpgradeConfirmModal
        open={pipeline.upgrade.open}
        loading={pipeline.upgrade.loading}
        original={prompt}
        result={pipeline.upgrade.result}
        onConfirm={pipeline.upgrade.confirm}
        onRerun={pipeline.upgrade.rerun}
        onCancel={pipeline.upgrade.cancel}
      />
      <ImageLightbox
        src={lightboxSrc}
        item={selectedItem}
        alt={selectedItem?.label}
        filename={
          selectedItem
            ? filenameFromRef(
                selectedItem.imageRef,
                `ais-${selectedItem.id}.png`,
              )
            : undefined
        }
        onClose={() => setLightboxSrc(null)}
        onDownload={() => {
          if (selectedItem) {
            downloadImage(
              selectedItem.imageRef,
              filenameFromRef(
                selectedItem.imageRef,
                `ais-${selectedItem.id}.png`,
              ),
            );
          }
        }}
      />
      <AppHeader />

      <StudioWorkspace>
        <GenerateLeftPanel
          promptTextareaRef={promptTextareaRef}
          onGenerate={pipeline.generate}
        />
        <GenerateRightPanel onLightboxOpen={setLightboxSrc} />
      </StudioWorkspace>
    </StudioPage>
  );
}
