/**
 * EditRightPanel — Edit 페이지 우측 결과 + 비교 분석 + 히스토리.
 *
 * 포함:
 *  - StudioResultHeader
 *  - EditResultViewer (조건부) 또는 StudioEmptyState
 *  - ComparisonAnalysisCard (afterItem 있을 때만)
 *  - HistorySectionHeader (그리드 컬럼 토글)
 *  - HistoryGallery (mode=edit 만 필터)
 *
 * 2026-04-26: edit/page.tsx 분해 step 3.
 *  - afterId 는 page-level state — props 로 받고 setAfterId 도 콜백
 *  - viewerHovered / gridCols 는 컴포넌트 내부 state
 */

"use client";

import { useState } from "react";
import { IconBtn } from "@/components/chrome/Chrome";
import ComparisonAnalysisCard from "@/components/studio/ComparisonAnalysisCard";
import HistoryGallery from "@/components/studio/HistoryGallery";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import { StudioRightPanel } from "@/components/studio/StudioLayout";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
import type { HistoryItem } from "@/lib/api-client";
import { useEditStore, useEditInputs } from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";
import EditResultViewer from "./EditResultViewer";

interface Props {
  afterId: string | null;
  setAfterId: (id: string | null) => void;
  /** Lightbox open — page-level state */
  onLightboxOpen: (src: string) => void;
  /** ComparisonAnalysisModal open — page-level state */
  onComparisonModalOpen: () => void;
}

export default function EditRightPanel({
  afterId,
  setAfterId,
  onLightboxOpen,
  onComparisonModalOpen,
}: Props) {
  const { sourceImage, sourceWidth, sourceHeight } = useEditInputs();
  const compareX = useEditStore((s) => s.compareX);
  const setCompareX = useEditStore((s) => s.setCompareX);

  const items = useHistoryStore((s) => s.items);
  const selectHistory = useHistoryStore((s) => s.select);

  const editResults = items.filter((x) => x.mode === "edit");
  const afterItem: HistoryItem | undefined = afterId
    ? editResults.find((x) => x.id === afterId)
    : undefined;

  const { analyze, isBusy } = useComparisonAnalysis();

  const [viewerHovered, setViewerHovered] = useState(false);
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /** 짝 일치 조건 — Before/After 슬라이더는 진짜 한 쌍만 표시 */
  const pairMatched =
    !!sourceImage &&
    !!afterItem &&
    !!afterItem.sourceRef &&
    afterItem.sourceRef === sourceImage;

  return (
    <StudioRightPanel>
      <StudioResultHeader title="수정 결과" meta="BEFORE · AFTER" />

      {pairMatched ? (
        <>
          <EditResultViewer
            afterItem={afterItem!}
            sourceImage={sourceImage!}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
            compareX={compareX}
            setCompareX={setCompareX}
            hovered={viewerHovered}
            onEnter={() => setViewerHovered(true)}
            onLeave={() => setViewerHovered(false)}
            onExpand={() => onLightboxOpen(afterItem!.imageRef)}
            onAfterIdReset={() => setAfterId(null)}
          />

          {/* 비교 분석 카드 — 수정 결과 대 원본 5축 평가 */}
          <ComparisonAnalysisCard
            item={afterItem!}
            busy={isBusy(afterItem!.id)}
            onAnalyze={() => analyze(afterItem!)}
            onOpenDetail={onComparisonModalOpen}
            onReanalyze={() => analyze(afterItem!)}
          />
        </>
      ) : (
        <StudioEmptyState size="normal">
          {!sourceImage
            ? "왼쪽에서 원본 이미지를 업로드해 주세요."
            : "이 원본의 수정 결과가 아직 없습니다. [수정 생성] 또는 아래 히스토리에서 선택하면 표시됩니다."}
        </StudioEmptyState>
      )}

      {/* ── 히스토리 ── */}
      <HistorySectionHeader
        title="수정 히스토리"
        count={editResults.length}
        actions={
          <IconBtn
            icon="grid"
            title={`그리드 (${gridCols} 컬럼 · 클릭으로 변경)`}
            onClick={cycleGrid}
          />
        }
      />

      <HistoryGallery
        items={editResults}
        gridCols={gridCols}
        selectedId={afterId}
        onTileClick={(it) => {
          // 히스토리 타일 클릭 = "이 수정 다시 보기"
          // sourceRef 있으면 원본도 같이 복원해 진짜 한 쌍 슬라이더로 표시.
          // sourceRef 없는 옛 row 는 안내 + source 보존 (슬라이더 자동 빈 상태).
          if (it.sourceRef) {
            useEditStore
              .getState()
              .setSource(
                it.sourceRef,
                `${it.label} · ${it.width}×${it.height}`,
                it.width,
                it.height,
              );
          } else {
            toast.info(
              "옛 항목 · 원본 미저장",
              "Before/After 슬라이더는 표시되지 않습니다.",
            );
          }
          setAfterId(it.id);
          selectHistory(it.id);
        }}
        onTileExpand={(it) => onLightboxOpen(it.imageRef)}
        onAfterDelete={(it) => {
          if (afterId === it.id) setAfterId(null);
        }}
        onUseAsSource={(it) => {
          // 이 결과 이미지를 다시 수정 원본으로 (연속 수정 플로우)
          useEditStore
            .getState()
            .setSource(
              it.imageRef,
              `${it.label} · ${it.width}×${it.height}`,
              it.width,
              it.height,
            );
          setAfterId(null);
          toast.info("원본으로 지정", it.label);
        }}
        emptyMessage="아직 수정 결과가 없습니다. 왼쪽에서 이미지를 업로드하고 [수정 생성]을 눌러주세요."
      />
    </StudioRightPanel>
  );
}
