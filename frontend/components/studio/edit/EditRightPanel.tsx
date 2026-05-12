/**
 * EditRightPanel — Edit 페이지 우측 결과 + 비교 분석 + 히스토리.
 *
 * 포함 (V5 시안 순서):
 *  1. StudioResultHeader (V5 — bilingual + meta pills)
 *  2. EditResultViewer (Hero 매트지 + Caption 슬롯 자체 포함) 또는 StudioEmptyState
 *  3. ComparisonAnalysisCard (afterItem 있을 때만 · filled state V5 amber)
 *  4. HistorySectionHeader (V5 Archive Header — eyebrow + bilingual + count + size chip)
 *  5. HistoryGallery (mode=edit 만 필터)
 *
 * 2026-04-26: edit/page.tsx 분해 step 3.
 *
 * 2026-05-02 디자인 V5 Phase 5 격상:
 *  - StudioResultHeader: titleEn="Edited" + meta pills (해상도 violet · BEFORE/AFTER · Lightning)
 *  - HistorySectionHeader: titleEn="History" + sizeBytes (useHistoryStats edit)
 *  - 회귀 위험 #7 보존: sourceRef NULL 옛 row 클릭 toast 안내 그대로
 */

"use client";

import { useState } from "react";
import ComparisonAnalysisCard from "@/components/studio/ComparisonAnalysisCard";
import HistoryGallery from "@/components/studio/HistoryGallery";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import { StudioRightPanel } from "@/components/studio/StudioLayout";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
import { useHistoryStats } from "@/hooks/useHistoryStats";
import type { HistoryItem } from "@/lib/api/types";
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
  const { sourceImage } = useEditInputs();
  const compareX = useEditStore((s) => s.compareX);
  const setCompareX = useEditStore((s) => s.setCompareX);
  const setPrompt = useEditStore((s) => s.setPrompt);
  const setLightning = useEditStore((s) => s.setLightning);
  // Phase 2 후속 (Codex Phase 4 리뷰 Medium #1) — 수동 비교 분석도 Edit promptMode 전파.
  const editPromptMode = useEditStore((s) => s.promptMode);

  const items = useHistoryStore((s) => s.items);
  const selectHistory = useHistoryStore((s) => s.select);

  const editResults = items.filter((x) => x.mode === "edit");
  const afterItem: HistoryItem | undefined = afterId
    ? editResults.find((x) => x.id === afterId)
    : undefined;

  const { analyze, isBusy } = useComparisonAnalysis();

  const [viewerHovered, setViewerHovered] = useState(false);

  // V5 Archive Header size chip — edit 모드 디스크 사용량 + DB 카운트
  // 2026-05-02: count 출처 store length → backend stats (DB 정확값) — limit 100 fetch 누락 영향 회피.
  const stats = useHistoryStats();
  const editSizeBytes = stats?.byMode.edit.sizeBytes;
  const editCount = stats?.byMode.edit.count ?? editResults.length;

  /** 짝 일치 조건 — Before/After 슬라이더는 진짜 한 쌍만 표시 */
  const pairMatched =
    !!sourceImage &&
    !!afterItem &&
    !!afterItem.sourceRef &&
    afterItem.sourceRef === sourceImage;

  // V5 result-meta-pills — 첫 violet pill = 해상도 (afterItem) · BEFORE·AFTER · Lightning
  const metaPills = afterItem ? (
    <>
      <span className="ais-result-pill ais-pill-violet mono">
        {afterItem.width} × {afterItem.height}
      </span>
      <span className="ais-result-pill mono">BEFORE · AFTER</span>
      {afterItem.lightning && (
        <span className="ais-result-pill ais-pill-amber mono">Lightning</span>
      )}
    </>
  ) : (
    <span className="ais-result-pill mono">BEFORE · AFTER</span>
  );

  return (
    <StudioRightPanel>
      <StudioResultHeader title="수정 결과" titleEn="Edited" meta={metaPills} />

      {pairMatched ? (
        <>
          <EditResultViewer
            afterItem={afterItem!}
            sourceImage={sourceImage!}
            compareX={compareX}
            setCompareX={setCompareX}
            hovered={viewerHovered}
            onEnter={() => setViewerHovered(true)}
            onLeave={() => setViewerHovered(false)}
            onExpand={() => onLightboxOpen(afterItem!.imageRef)}
            onAfterIdReset={() => setAfterId(null)}
          />

          {/* 비교 분석 카드 — 수정 결과 대 원본 5축 평가 (V5 amber filled) */}
          <ComparisonAnalysisCard
            item={afterItem!}
            busy={isBusy(afterItem!.id)}
            onAnalyze={() => analyze(afterItem!, { promptMode: editPromptMode })}
            onOpenDetail={onComparisonModalOpen}
            onReanalyze={() => analyze(afterItem!, { promptMode: editPromptMode })}
          />
        </>
      ) : (
        <StudioEmptyState size="normal">
          {!sourceImage
            ? "왼쪽에서 원본 이미지를 업로드해 주세요."
            : "이 원본의 수정 결과가 아직 없습니다. [수정 생성] 또는 아래 히스토리에서 선택하면 표시됩니다."}
        </StudioEmptyState>
      )}

      {/* ── V5 Archive Header — bilingual + count + size chip ── */}
      <HistorySectionHeader
        title="보관"
        titleEn="History"
        count={editCount}
        sizeBytes={editSizeBytes}
      />

      <HistoryGallery
        items={editResults}
        selectedId={afterId}
        onTileClick={(it) => {
          // 히스토리 타일 클릭 = "이 수정 다시 보기".
          // sourceRef 있으면 원본도 같이 복원해 진짜 한 쌍 슬라이더로 표시하고,
          // 좌측 수정 지시/Lightning 도 당시 설정으로 맞춰 재실행 동선을 짧게 만든다.
          // sourceRef 없는 옛 row 는 안내 + source 보존 (슬라이더 자동 빈 상태).
          // ⚠ 회귀 위험 #7 보존 — 이 toast 분기 제거하면 옛 row 사용자 혼란
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
          setPrompt(it.prompt);
          setLightning(it.lightning);
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
