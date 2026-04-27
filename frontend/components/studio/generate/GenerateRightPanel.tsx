/**
 * GenerateRightPanel — Generate 페이지 우측 결과 + 히스토리 패널.
 *
 * 포함:
 *  - StudioResultHeader
 *  - GenerateResultViewer (선택 아이템) 또는 StudioEmptyState
 *  - HistorySectionHeader (그리드 컬럼 토글)
 *  - HistoryGallery (Masonry)
 *
 * 2026-04-26 (task #5): generate/page.tsx 분해 step 3.
 */

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBtn } from "@/components/chrome/Chrome";
import HistoryGallery from "@/components/studio/HistoryGallery";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import { StudioRightPanel } from "@/components/studio/StudioLayout";
import {
  downloadImage,
  copyText,
  filenameFromRef,
  urlToDataUrl,
} from "@/lib/image-actions";
import { useEditStore } from "@/stores/useEditStore";
import {
  useGenerateInputs,
  useGenerateStore,
} from "@/stores/useGenerateStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";
import GenerateResultViewer from "./GenerateResultViewer";

interface Props {
  /** Lightbox open 콜백 (page-level state) */
  onLightboxOpen: (src: string) => void;
}

export default function GenerateRightPanel({ onLightboxOpen }: Props) {
  const router = useRouter();
  const { setPrompt, applyLightning, lightning } = useGenerateInputs();
  // setDimensions 는 useGenerateInputs 가 묶고 있지만 재선택 보일러 줄이려고 직접 호출.
  const setDimensions = useGenerateStore((s) => s.setDimensions);

  const items = useHistoryStore((s) => s.items);
  const selectedId = useHistoryStore((s) => s.selectedId);
  const selectItem = useHistoryStore((s) => s.select);

  const genItems = useMemo(
    () => items.filter((i) => i.mode === "generate"),
    [items],
  );
  const selectedItem = genItems.find((i) => i.id === selectedId);

  const [viewerHovered, setViewerHovered] = useState(false);
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /** 결과/히스토리 공용 — 이 이미지를 /edit 의 원본으로 보내고 라우팅. */
  const sendToEdit = async (it: { id: string; imageRef: string; label: string }) => {
    toast.info("수정으로 전송 중…");
    const res = await urlToDataUrl(it.imageRef);
    if (!res) {
      toast.error("전송 실패", "이미지를 불러올 수 없음");
      return;
    }
    useEditStore
      .getState()
      .setSource(
        res.dataUrl,
        `${it.label} · ${res.width}×${res.height}`,
        res.width,
        res.height,
      );
    router.push("/edit");
  };

  return (
    <StudioRightPanel>
      <StudioResultHeader
        title="생성 결과"
        meta={
          selectedItem ? `${selectedItem.width}×${selectedItem.height}` : "PNG"
        }
      />

      {selectedItem ? (
        <GenerateResultViewer
          item={selectedItem}
          hovered={viewerHovered}
          onEnter={() => setViewerHovered(true)}
          onLeave={() => setViewerHovered(false)}
          onExpand={() => onLightboxOpen(selectedItem.imageRef)}
          onDownload={() =>
            downloadImage(
              selectedItem.imageRef,
              filenameFromRef(
                selectedItem.imageRef,
                `ais-${selectedItem.id}.png`,
              ),
            )
          }
          onCopyPrompt={() =>
            copyText(selectedItem.prompt || "", "프롬프트")
          }
          onSendToEdit={() => sendToEdit(selectedItem)}
          onReuse={() => {
            // 재생성 = 프롬프트 + 사이즈 + Lightning 복원.
            // Seed/Step/CFG 는 UI 제거 + 매번 랜덤 정책이라 복원 안 함.
            setPrompt(selectedItem.prompt);
            setDimensions(selectedItem.width, selectedItem.height);
            if (selectedItem.lightning !== lightning) {
              applyLightning(selectedItem.lightning);
            }
            toast.info(
              "재생성 준비",
              `${selectedItem.width}×${selectedItem.height} · [생성] 눌러`,
            );
          }}
        />
      ) : (
        <StudioEmptyState size="normal">
          아직 생성된 이미지가 없습니다. 프롬프트 입력 후 <b>생성</b> 버튼을
          눌러 주세요.
        </StudioEmptyState>
      )}

      <HistorySectionHeader
        title="생성 히스토리"
        count={genItems.length}
        actions={
          <IconBtn
            icon="grid"
            title={`그리드 (${gridCols} 컬럼 · 클릭으로 변경)`}
            onClick={cycleGrid}
          />
        }
      />

      <HistoryGallery
        items={genItems}
        gridCols={gridCols}
        selectedId={selectedId ?? null}
        onTileClick={(it) => selectItem(it.id)}
        onTileExpand={(it) => onLightboxOpen(it.imageRef)}
        onSendToEdit={(it) => sendToEdit(it)}
        emptyMessage={null}
      />
    </StudioRightPanel>
  );
}
