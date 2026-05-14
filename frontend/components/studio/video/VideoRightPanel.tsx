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
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useVideoStore, useVideoRunning } from "@/stores/useVideoStore";

interface Props {
  /** Lightbox open — page-level state */
  onLightboxOpen: (item: HistoryItem) => void;
}

export default function VideoRightPanel({ onLightboxOpen }: Props) {
  const lastVideoRef = useVideoStore((s) => s.lastVideoRef);
  const { running } = useVideoRunning();
  const items = useHistoryStore((s) => s.items);
  const videoResults = items.filter((x) => x.mode === "video");
  // 2026-05-03: 카운트는 그리드와 1:1 매칭되는 store length 사용 (보이는 수 = 표시 수).
  // sizeBytes 는 DB 디스크 사용량이라 stats 만이 알 수 있음 → 그대로 stats 의존.
  const stats = useHistoryStats();
  const videoCount = videoResults.length;
  const videoSizeBytes = stats?.byMode.video.sizeBytes;

  /** 현재 재생할 mp4: lastVideoRef (세션) — 진입 시 빈 상태 (히스토리 fallback 제거) */
  const playingRef = lastVideoRef ?? null;
  const playingItem = playingRef
    ? videoResults.find((v) => v.imageRef === playingRef)
    : undefined;
  const resultState = running ? "loading" : playingRef ? "done" : "idle";

  // V5 result-meta-pills (Generate/Edit 와 통일 · 2026-05-03):
  //   해상도 (violet) · 실제 영상 메타 (확장자 / duration / fps · HistoryItem video 필드)
  //   · Lightning (amber) · NSFW (있으면).
  //   playing 이 없으면 fallback 으로 빈 spec.
  const ext = playingItem
    ? (playingItem.imageRef.split(".").pop() || "mp4").toUpperCase()
    : "MP4";
  const specParts: string[] = [ext];
  if (playingItem?.durationSec) specParts.push(`${playingItem.durationSec}s`);
  if (playingItem?.fps) specParts.push(`${playingItem.fps}fps`);
  const specLabel = specParts.join(" · ");

  // Phase 5 후속 (2026-05-03 fix · 사용자 피드백) — 모델명 pill 추가.
  // tone 색상은 HistoryTile 배지와 동일 매핑 (Wan 22 violet · LTX cyan).
  const modelToneStyle =
    playingItem?.modelId === "wan22"
      ? {
          background: "rgba(139, 92, 246, 0.15)",
          color: "#a78bfa",
          border: "1px solid rgba(139, 92, 246, 0.35)",
        }
      : {
          background: "rgba(34, 211, 238, 0.15)",
          color: "#67e8f9",
          border: "1px solid rgba(34, 211, 238, 0.35)",
        };

  const metaPills = resultState === "done" && playingItem ? (
    <>
      <span className="ais-result-pill ais-pill-violet mono">
        {playingItem.width} × {playingItem.height}
      </span>
      {playingItem.model && (
        <span
          className="ais-result-pill mono"
          title={`영상 모델: ${playingItem.model}`}
          style={modelToneStyle}
        >
          {playingItem.model}
        </span>
      )}
      <span className="ais-result-pill mono">{specLabel}</span>
      {playingItem.lightning && (
        <span className="ais-result-pill ais-pill-amber mono">Lightning</span>
      )}
      {playingItem.adult && (
        <span className="ais-result-pill mono">NSFW</span>
      )}
    </>
  ) : null;

  return (
    <StudioRightPanel>
      <StudioResultHeader
        title="영상 결과"
        titleEn="Rendered"
        meta={metaPills}
      />

      <ResultBox
        state={resultState}
        modifier="edit"
        loadingLabel="영상 생성 중…"
        emptyState={
          <StudioEmptyState
            size="normal"
            title="영상 대기 중"
            description="원본 이미지와 영상 지시를 입력하고 영상 생성 버튼을 눌러 주세요."
          />
        }
      >
        {playingRef && (
          <VideoContent
            src={playingRef}
            filename={filenameFromRef(playingRef, "ais-video.mp4")}
            onExpand={() => {
              const hit = videoResults.find((v) => v.imageRef === playingRef);
              if (hit) onLightboxOpen(hit);
            }}
          />
        )}
      </ResultBox>

      {/* V5 Caption 슬롯 — Generate/Edit 와 통일 (2026-05-03).
       *  upgradedPrompt 우선 → 없으면 사용자 영상 지시 fallback.
       *  running/empty 상태엔 playingItem 자체가 없어 자연스럽게 미노출. */}
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
        title="보관"
        titleEn="History"
        count={videoCount}
        sizeBytes={videoSizeBytes}
      />

      <HistoryGallery
        items={videoResults}
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
