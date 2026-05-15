"use client";

import { useEffect, useRef, useState } from "react";
import AppHeader from "@/components/chrome/AppHeader";
import ImageLightbox from "@/components/studio/ImageLightbox";
import VideoLabLeftPanel from "@/components/studio/lab/VideoLabLeftPanel";
import VideoLabRightPanel from "@/components/studio/lab/VideoLabRightPanel";
import ProgressModal from "@/components/studio/ProgressModal";
import {
  StudioPage,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import { useAutoCloseModal } from "@/hooks/useAutoCloseModal";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { useVideoLabPipeline } from "@/hooks/useVideoLabPipeline";
import type { HistoryItem } from "@/lib/api/types";
import { filenameFromRef } from "@/lib/image-actions";
import {
  useVideoLabInputs,
  useVideoLabRunning,
} from "@/stores/useVideoLabStore";

export default function VideoLabPage() {
  const { prompt, setPrompt } = useVideoLabInputs();
  const { running } = useVideoLabRunning();
  const { generate } = useVideoLabPipeline();
  const [progressOpen, setProgressOpen] = useAutoCloseModal(running, 1400);
  const [lightboxItem, setLightboxItem] = useState<HistoryItem | null>(null);
  const promptClearedRef = useRef(false);
  const promptTextareaRef = useAutoGrowTextarea(prompt);

  useEffect(() => {
    if (promptClearedRef.current) return;
    promptClearedRef.current = true;
    setPrompt("");
  }, [setPrompt]);

  return (
    <StudioPage>
      {progressOpen && (
        <ProgressModal mode="lab_video" onClose={() => setProgressOpen(false)} />
      )}
      {lightboxItem && (
        <ImageLightbox
          src={lightboxItem.imageRef}
          alt={lightboxItem.label}
          filename={filenameFromRef(lightboxItem.imageRef, "ais-lab-video.mp4")}
          item={lightboxItem}
          onClose={() => setLightboxItem(null)}
        />
      )}
      <AppHeader />

      <StudioWorkspace>
        <VideoLabLeftPanel
          promptTextareaRef={promptTextareaRef}
          onGenerate={generate}
        />
        <VideoLabRightPanel onLightboxOpen={setLightboxItem} />
      </StudioWorkspace>
    </StudioPage>
  );
}
