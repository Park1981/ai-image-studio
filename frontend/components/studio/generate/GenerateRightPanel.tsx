/**
 * GenerateRightPanel — Generate 페이지 우측 결과 + 히스토리 패널.
 *
 * 포함:
 *  - StudioResultHeader (V5 — Fraunces italic bilingual + meta pills)
 *  - GenerateResultViewer (선택 아이템 · Caption 슬롯 포함) 또는 StudioEmptyState
 *  - HistorySectionHeader (V5 Archive Header — eyebrow + bilingual + count + size chip)
 *  - HistoryGallery (Masonry · ResizeObserver 자동 컬럼 보존)
 *
 * 2026-04-26 (task #5): generate/page.tsx 분해 step 3.
 *
 * 2026-05-02 디자인 V5 Phase 4 격상:
 *  - StudioResultHeader: titleEn="Generated" + meta pills (1672×941 violet · PNG · steps · cfg)
 *  - HistorySectionHeader: titleEn="History" + sizeBytes (useHistoryStats 의 generate.sizeBytes)
 *  - GenerateResultViewer: download 버튼 제거 → 4 버튼 (자세히/복사/수정/리프레시) — onDownload prop 제거
 *  - 회귀 위험 #1 보존: HistoryGallery ResizeObserver 자동 컬럼 그대로 (gridCols prop 미주입)
 */

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HistoryGallery from "@/components/studio/HistoryGallery";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import { ResultBox } from "@/components/studio/ResultBox";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import { StudioRightPanel } from "@/components/studio/StudioLayout";
import { useHistoryStats } from "@/hooks/useHistoryStats";
import { copyText, urlToDataUrl } from "@/lib/image-actions";
import { useEditStore } from "@/stores/useEditStore";
import {
  useGenerateInputs,
  useGenerateRunning,
  useGenerateStore,
} from "@/stores/useGenerateStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";
import GenerateContent from "./GenerateContent";

interface Props {
  /** Lightbox open 콜백 (page-level state) */
  onLightboxOpen: (src: string) => void;
}

export default function GenerateRightPanel({ onLightboxOpen }: Props) {
  const router = useRouter();
  const { setPrompt, applyLightning, lightning } = useGenerateInputs();
  const { generating } = useGenerateRunning();
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
  const resultState = generating ? "loading" : selectedItem ? "done" : "idle";
  const selectedAspectRatio =
    selectedItem && selectedItem.width > 0 && selectedItem.height > 0
      ? `${selectedItem.width} / ${selectedItem.height}`
      : undefined;

  const [viewerHovered, setViewerHovered] = useState(false);

  // V5 Archive Header size chip — generate 모드 디스크 사용량 + DB 카운트
  // 2026-05-02: count 출처 store length → backend stats (DB 정확값) — limit 100 fetch 누락 영향 회피.
  const stats = useHistoryStats();
  const generateSizeBytes = stats?.byMode.generate.sizeBytes;
  const generateCount = stats?.byMode.generate.count ?? genItems.length;

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

  // V5 result-meta-pills — 첫 violet pill = 해상도, 추가 pill = 모델/Lightning
  // 2026-05-02: 이미지 미선택 시 pill 자체 숨김 (옛 PNG fallback 제거 — 의미 없음).
  const metaPills = resultState === "done" && selectedItem ? (
    <>
      <span className="ais-result-pill ais-pill-violet mono">
        {selectedItem.width} × {selectedItem.height}
      </span>
      <span className="ais-result-pill mono">PNG</span>
      {selectedItem.lightning && (
        <span className="ais-result-pill ais-pill-amber mono">Lightning</span>
      )}
    </>
  ) : null;

  return (
    <StudioRightPanel>
      <StudioResultHeader title="결과" titleEn="Latest" meta={metaPills} />

      <ResultBox
        state={resultState}
        emptyState={
          <StudioEmptyState size="normal">
            아직 생성된 이미지가 없습니다. 프롬프트 입력 후 <b>생성</b> 버튼을
            눌러 주세요.
          </StudioEmptyState>
        }
        style={
          selectedAspectRatio
            ? { aspectRatio: selectedAspectRatio, maxHeight: "65vh" }
            : undefined
        }
      >
        {selectedItem && (
          <GenerateContent
            item={selectedItem}
            hovered={viewerHovered}
            onEnter={() => setViewerHovered(true)}
            onLeave={() => setViewerHovered(false)}
            onExpand={() => onLightboxOpen(selectedItem.imageRef)}
            onCopyPrompt={() =>
              void copyText(selectedItem.prompt || "", "프롬프트")
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
        )}
      </ResultBox>

      {resultState === "done" &&
        selectedItem &&
        (selectedItem.upgradedPrompt || selectedItem.prompt) && (
          <div className="ais-result-caption">
            <p
              className="ais-result-caption-prompt"
              title={selectedItem.upgradedPrompt || selectedItem.prompt}
            >
              {selectedItem.upgradedPrompt || selectedItem.prompt}
            </p>
          </div>
        )}

      <HistorySectionHeader
        title="보관"
        titleEn="History"
        count={generateCount}
        sizeBytes={generateSizeBytes}
      />

      <HistoryGallery
        items={genItems}
        selectedId={selectedId ?? null}
        onTileClick={(it) => selectItem(it.id)}
        onTileExpand={(it) => onLightboxOpen(it.imageRef)}
        onSendToEdit={(it) => sendToEdit(it)}
        emptyMessage={null}
      />
    </StudioRightPanel>
  );
}
