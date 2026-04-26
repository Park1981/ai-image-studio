/**
 * VideoRightPanel — Video 페이지 우측 결과 + 히스토리.
 *
 * 포함:
 *  - StudioResultHeader (MP4 · 5s · 25fps)
 *  - VideoPlayerCard (lastVideoRef 재생)
 *  - HistorySectionHeader (그리드 컬럼 토글)
 *  - HistoryGallery (mode=video 만 필터)
 *
 * 2026-04-26: video/page.tsx 분해 step 2.
 *  - lightboxItem 은 page-level state — onLightboxOpen 콜백
 *  - lastVideoRef / videoResults 는 컴포넌트 내부에서 store 직접 구독
 */

"use client";

import { useState } from "react";
import { IconBtn } from "@/components/chrome/Chrome";
import HistoryGallery from "@/components/studio/HistoryGallery";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import { StudioRightPanel } from "@/components/studio/StudioLayout";
import VideoPlayerCard from "@/components/studio/VideoPlayerCard";
import type { HistoryItem } from "@/lib/api-client";
import { filenameFromRef } from "@/lib/image-actions";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useVideoStore, useVideoRunning } from "@/stores/useVideoStore";

interface Props {
  /** Lightbox open — page-level state */
  onLightboxOpen: (item: HistoryItem) => void;
}

export default function VideoRightPanel({ onLightboxOpen }: Props) {
  const lastVideoRef = useVideoStore((s) => s.lastVideoRef);
  const { running, pipelineLabel } = useVideoRunning();
  const items = useHistoryStore((s) => s.items);
  const videoResults = items.filter((x) => x.mode === "video");

  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /** 현재 재생할 mp4: lastVideoRef (세션) — 진입 시 빈 상태 (히스토리 fallback 제거) */
  const playingRef = lastVideoRef ?? null;

  return (
    <StudioRightPanel>
      <StudioResultHeader title="영상 결과" meta="MP4 · 5s · 25fps" />

      <VideoPlayerCard
        src={playingRef}
        running={running}
        label={pipelineLabel}
        filename={
          playingRef ? filenameFromRef(playingRef, "ais-video.mp4") : undefined
        }
        onExpand={
          // 현재 재생 중 ref 에 해당하는 history item 을 라이트박스로
          playingRef
            ? () => {
                const hit = videoResults.find(
                  (v) => v.imageRef === playingRef,
                );
                if (hit) onLightboxOpen(hit);
              }
            : undefined
        }
      />

      <HistorySectionHeader
        title="영상 히스토리"
        count={videoResults.length}
        actions={
          <IconBtn
            icon="grid"
            title={`그리드 (${gridCols} 컬럼 · 클릭으로 변경)`}
            onClick={cycleGrid}
          />
        }
      />

      <HistoryGallery
        items={videoResults}
        gridCols={gridCols}
        // selectedId 는 HistoryItem.id 기준 — playingRef(imageRef) 로 선택 표시.
        selectedId={
          videoResults.find((v) => v.imageRef === playingRef)?.id ?? null
        }
        onTileClick={(it) => {
          // 플레이어에 지정 — 세션 state (lastVideoRef)
          useVideoStore.getState().setLastVideoRef(it.imageRef);
        }}
        onTileExpand={(it) => onLightboxOpen(it)}
        emptyMessage="아직 생성된 영상이 없습니다."
      />
    </StudioRightPanel>
  );
}
