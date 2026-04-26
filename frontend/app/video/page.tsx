/**
 * Video Mode Page — LTX-2.3 Image-to-Video (i2v).
 *
 * 2026-04-26: 591줄 → 분해 (Generate/Edit 패턴 동일).
 *  - VideoLeftPanel (입력 + 해상도 슬라이더 + 토글 + VRAM 배너 + CTA)
 *    → components/studio/video/VideoLeftPanel.tsx
 *  - VideoRightPanel (플레이어 + 히스토리)
 *    → components/studio/video/VideoRightPanel.tsx
 *  - useVideoInputs/useVideoRunning 그룹 selectors
 *  - useAutoCloseModal / useAutoGrowTextarea 공용 훅
 *
 * Page 책임 (남은 것):
 *  - StudioPage shell + AppHeader + StudioWorkspace 조립
 *  - 모달 마운트 (Progress / ImageLightbox)
 *  - 진입 시 1회 effect (prompt clear)
 *  - page-level state: lightboxItem
 *  - 파이프라인 훅 (useVideoPipeline) 보유
 */

"use client";

import { useEffect, useRef, useState } from "react";
import AppHeader from "@/components/chrome/AppHeader";
import ImageLightbox from "@/components/studio/ImageLightbox";
import ProgressModal from "@/components/studio/ProgressModal";
import {
  StudioPage,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import VideoLeftPanel from "@/components/studio/video/VideoLeftPanel";
import VideoRightPanel from "@/components/studio/video/VideoRightPanel";
import { useAutoCloseModal } from "@/hooks/useAutoCloseModal";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { useVideoPipeline } from "@/hooks/useVideoPipeline";
import type { HistoryItem } from "@/lib/api-client";
import { filenameFromRef } from "@/lib/image-actions";
import { useVideoInputs, useVideoRunning } from "@/stores/useVideoStore";

export default function VideoPage() {
  /* ── store (prompt 만 page 가 관여 — auto-grow ref 필요) ── */
  const { prompt, setPrompt } = useVideoInputs();
  const { running } = useVideoRunning();

  /* ── 파이프라인 훅 ── */
  const { generate: handleGenerate } = useVideoPipeline();

  /* ── page-level state ── */
  const [progressOpen, setProgressOpen] = useAutoCloseModal(running, 1400);
  const [lightboxItem, setLightboxItem] = useState<HistoryItem | null>(null);

  /* ── 진입 시 영상 지시는 빈 입력으로 시작 ── */
  const promptClearedRef = useRef(false);
  useEffect(() => {
    if (promptClearedRef.current) return;
    promptClearedRef.current = true;
    setPrompt("");
  }, [setPrompt]);

  /* ── prompt textarea auto-grow ref ── */
  const promptTextareaRef = useAutoGrowTextarea(prompt);

  return (
    <StudioPage>
      {progressOpen && (
        <ProgressModal mode="video" onClose={() => setProgressOpen(false)} />
      )}
      {lightboxItem && (
        <ImageLightbox
          src={lightboxItem.imageRef}
          alt={lightboxItem.label}
          filename={filenameFromRef(lightboxItem.imageRef, "ais-video.mp4")}
          item={lightboxItem}
          onClose={() => setLightboxItem(null)}
        />
      )}
      <AppHeader />

      <StudioWorkspace>
        <VideoLeftPanel
          promptTextareaRef={promptTextareaRef}
          onGenerate={handleGenerate}
        />
        <VideoRightPanel onLightboxOpen={setLightboxItem} />
      </StudioWorkspace>
    </StudioPage>
  );
}
