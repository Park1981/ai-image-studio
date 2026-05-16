"use client";

import { useRef } from "react";
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
  const wanVideoRef = useRef<HTMLVideoElement | null>(null);
  const sulphurVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastVideoRef = useVideoLabStore((s) => s.lastVideoRef);
  const lastPairRefs = useVideoLabStore((s) => s.lastPairRefs);
  const lastError = useVideoLabStore((s) => s.lastError);
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
  const pairWan = lastPairRefs?.wan22
    ? items.find((item) => item.imageRef === lastPairRefs.wan22)
    : undefined;
  const pairSulphur = lastPairRefs?.sulphur
    ? items.find((item) => item.imageRef === lastPairRefs.sulphur)
    : undefined;
  const pairItems = [
    pairWan ? { key: "wan22", label: "Wan 2.2", item: pairWan } : null,
    pairSulphur
      ? { key: "ltx-sulphur", label: "Sulphur", item: pairSulphur }
      : null,
  ].filter(Boolean) as Array<{
    key: "wan22" | "ltx-sulphur";
    label: string;
    item: HistoryItem;
  }>;
  const hasPairResult = pairItems.length > 0;
  const resultState = running
    ? "loading"
    : hasPairResult || playingRef
    ? "done"
    : "idle";
  const ext = playingItem
    ? (playingItem.imageRef.split(".").pop() || "mp4").toUpperCase()
    : "MP4";
  const specParts = [ext];
  if (playingItem?.durationSec) specParts.push(`${playingItem.durationSec}s`);
  if (playingItem?.fps) specParts.push(`${playingItem.fps}fps`);

  const syncPairPlay = () => {
    const videos = [wanVideoRef.current, sulphurVideoRef.current].filter(
      Boolean,
    ) as HTMLVideoElement[];
    for (const video of videos) {
      video.currentTime = 0;
      video.muted = true;
      void video.play().catch(() => undefined);
    }
  };

  const syncPairPause = () => {
    for (const video of [wanVideoRef.current, sulphurVideoRef.current]) {
      video?.pause();
    }
  };

  const metaPills = resultState === "done" && hasPairResult ? (
    <>
      <span className="ais-result-pill ais-pill-violet mono">비교 결과</span>
      <span className="ais-result-pill mono">Wan → Sulphur</span>
      <span className="ais-result-pill mono">{pairItems.length}/2 완료</span>
    </>
  ) : resultState === "done" && playingItem ? (
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
        {hasPairResult ? (
          <div className="ais-lab-pair-stack">
            <div className="ais-lab-pair-syncbar">
              <button type="button" onClick={syncPairPlay}>
                동시 재생
              </button>
              <button type="button" onClick={syncPairPause}>
                동시 정지
              </button>
            </div>
            <div className="ais-lab-pair-grid">
              {pairItems.map(({ key, label, item }) => (
                <div className="ais-lab-pair-card" key={key}>
                  <div className="ais-lab-pair-card-head">
                    <strong>{label}</strong>
                    <span className="mono">
                      {item.width}×{item.height} · {item.fps ?? "?"}fps
                    </span>
                  </div>
                  <VideoContent
                    src={item.imageRef}
                    filename={filenameFromRef(item.imageRef, `${key}.mp4`)}
                    videoRef={key === "wan22" ? wanVideoRef : sulphurVideoRef}
                    muted
                    onExpand={() => onLightboxOpen(item)}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : playingRef ? (
          <VideoContent
            src={playingRef}
            filename={filenameFromRef(playingRef, "ais-lab-video.mp4")}
            onExpand={() => {
              const hit = labResults.find((item) => item.imageRef === playingRef);
              if (hit) onLightboxOpen(hit);
            }}
          />
        ) : null}
      </ResultBox>

      {lastError && (
        <div className="ais-lab-error-note" role="alert">
          <strong>최근 Lab 오류</strong>
          <p>{lastError}</p>
        </div>
      )}

      {resultState === "done" &&
        (hasPairResult ? pairSulphur || pairWan : playingItem) &&
        ((hasPairResult ? pairSulphur || pairWan : playingItem)?.upgradedPrompt ||
          (hasPairResult ? pairSulphur || pairWan : playingItem)?.prompt) && (
          <div className="ais-result-caption">
            <p
              className="ais-result-caption-prompt"
              title={
                (hasPairResult ? pairSulphur || pairWan : playingItem)
                  ?.upgradedPrompt ||
                (hasPairResult ? pairSulphur || pairWan : playingItem)?.prompt
              }
            >
              {(hasPairResult ? pairSulphur || pairWan : playingItem)
                ?.upgradedPrompt ||
                (hasPairResult ? pairSulphur || pairWan : playingItem)?.prompt}
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
