"use client";

import HistoryGallery from "@/components/studio/HistoryGallery";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import { ResultBox } from "@/components/studio/ResultBox";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import { StudioRightPanel } from "@/components/studio/StudioLayout";
import VideoContent from "@/components/studio/VideoContent";
import { useHistoryStats } from "@/hooks/useHistoryStats";
import type { HistoryItem } from "@/lib/api/types";
import { filenameFromRef } from "@/lib/image-actions";
import { LAB_LTX_SULPHUR_PRESET } from "@/lib/lab-presets";
import { useHistoryStore } from "@/stores/useHistoryStore";
import {
  useVideoLabRunning,
  useVideoLabStore,
} from "@/stores/useVideoLabStore";

interface Props {
  onLightboxOpen: (item: HistoryItem) => void;
}

export default function VideoLabRightPanel({ onLightboxOpen }: Props) {
  const lastVideoRef = useVideoLabStore((s) => s.lastVideoRef);
  const { running } = useVideoLabRunning();
  const items = useHistoryStore((s) => s.items);
  const labResults = items.filter(
    (item) =>
      item.mode === "video" &&
      item.model === LAB_LTX_SULPHUR_PRESET.displayName,
  );
  const stats = useHistoryStats();
  const playingRef = lastVideoRef ?? null;
  const playingItem = playingRef
    ? labResults.find((item) => item.imageRef === playingRef)
    : undefined;
  const resultState = running ? "loading" : playingRef ? "done" : "idle";
  const ext = playingItem
    ? (playingItem.imageRef.split(".").pop() || "mp4").toUpperCase()
    : "MP4";
  const specParts = [ext];
  if (playingItem?.durationSec) specParts.push(`${playingItem.durationSec}s`);
  if (playingItem?.fps) specParts.push(`${playingItem.fps}fps`);

  const metaPills = resultState === "done" && playingItem ? (
    <>
      <span className="ais-result-pill ais-pill-violet mono">
        {playingItem.width} × {playingItem.height}
      </span>
      <span className="ais-result-pill mono">{playingItem.model}</span>
      <span className="ais-result-pill mono">{specParts.join(" · ")}</span>
      {playingItem.lightning && (
        <span className="ais-result-pill ais-pill-amber mono">Lightning</span>
      )}
      {playingItem.adult && <span className="ais-result-pill mono">NSFW</span>}
    </>
  ) : null;

  return (
    <StudioRightPanel>
      <StudioResultHeader title="Lab 결과" titleEn="Sulphur" meta={metaPills} />

      <ResultBox
        state={resultState}
        modifier="edit"
        loadingLabel="Lab 영상 생성 중…"
        emptyState={
          <StudioEmptyState
            size="normal"
            title="Lab 영상 대기 중"
            description="원본 이미지와 LoRA 조합을 정하고 Render를 눌러 주세요."
          />
        }
      >
        {playingRef && (
          <VideoContent
            src={playingRef}
            filename={filenameFromRef(playingRef, "ais-lab-video.mp4")}
            onExpand={() => {
              const hit = labResults.find((item) => item.imageRef === playingRef);
              if (hit) onLightboxOpen(hit);
            }}
          />
        )}
      </ResultBox>

      {resultState === "done" &&
        playingItem &&
        (playingItem.upgradedPrompt || playingItem.prompt) && (
          <div className="ais-result-caption">
            <p
              className="ais-result-caption-prompt"
              title={playingItem.upgradedPrompt || playingItem.prompt}
            >
              {playingItem.upgradedPrompt || playingItem.prompt}
            </p>
          </div>
        )}

      <HistorySectionHeader
        title="Lab 보관"
        titleEn="History"
        count={labResults.length}
        sizeBytes={stats?.byMode.video.sizeBytes}
      />

      <HistoryGallery
        items={labResults}
        selectedId={
          labResults.find((item) => item.imageRef === playingRef)?.id ?? null
        }
        onTileClick={(item) => {
          useVideoLabStore.getState().setLastVideoRef(item.imageRef);
        }}
        onTileExpand={(item) => onLightboxOpen(item)}
        emptyMessage="아직 Lab 영상 결과가 없습니다."
      />
    </StudioRightPanel>
  );
}
