/**
 * EditResultViewer — Edit 페이지 결과 뷰어 (Before/After 슬라이더 + 호버 액션바).
 *
 * 2026-04-26: edit/page.tsx 분해 step 2.
 *  - Generate 의 GenerateResultViewer 패턴과 통일 (호버 props + 콜백)
 *  - 단순 액션 (Download / UseAsSource / Reuse) 은 store 직접 호출 — page 슬림화
 *  - 외부 영향 액션 (Lightbox open / Comparison detail) 만 콜백
 *
 * 조건부 렌더는 부모 (EditRightPanel) 가 담당 — 이 컴포넌트는 항상 afterItem 보유 가정.
 */

"use client";

import BeforeAfterSlider from "@/components/studio/BeforeAfterSlider";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";
import type { HistoryItem } from "@/lib/api/types";
import { downloadImage, filenameFromRef } from "@/lib/image-actions";
import { useEditStore } from "@/stores/useEditStore";
import { toast } from "@/stores/useToastStore";

interface Props {
  afterItem: HistoryItem;
  /** 짝 일치한 원본 이미지 (afterItem.sourceRef === sourceImage 통과한 후) */
  sourceImage: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  compareX: number;
  setCompareX: (v: number) => void;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  /** Lightbox open — page-level state */
  onExpand: () => void;
  /** "이 결과를 다음 수정의 원본으로" 클릭 후 afterId 초기화 — page-level state */
  onAfterIdReset: () => void;
}

export default function EditResultViewer({
  afterItem,
  sourceImage,
  sourceWidth,
  sourceHeight,
  compareX,
  setCompareX,
  hovered,
  onEnter,
  onLeave,
  onExpand,
  onAfterIdReset,
}: Props) {
  const aspectRatio =
    sourceWidth && sourceHeight ? `${sourceWidth} / ${sourceHeight}` : "16 / 10";

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        // 2026-04-27 매트 카드 (Generate 와 통일): 카드 안 padding → 슬라이더가 떠있는 느낌.
        // dot grid 배경 (Figma 캔버스 톤) + boxShadow + border (액자).
        // BeforeAfter 자체에 자체 dimensions (aspectRatio + maxHeight) → 카드 안 자유 정렬.
        width: "100%",
        display: "flex",
        justifyContent: "center",
        backgroundColor: "var(--surface)",
        backgroundImage:
          "radial-gradient(circle, rgba(0,0,0,.06) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      {/* 내부 wrapper — BeforeAfter 와 크기가 같아 액션바가 이미지 하단에만 깔림 */}
      <div
        style={{
          position: "relative",
          // 슬라이더 자체 그림자 + 옅은 테두리 (매트 위 떠있는 사진 효과)
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          boxShadow:
            "0 10px 32px rgba(0,0,0,.14), 0 3px 10px rgba(0,0,0,.08)",
          border: "1px solid rgba(0,0,0,.06)",
        }}
      >
        <BeforeAfterSlider
          beforeSrc={sourceImage}
          afterSeed={afterItem.imageRef || afterItem.id}
          compareX={compareX}
          setCompareX={setCompareX}
          aspectRatio={aspectRatio}
        />
        {/* 호버 액션바 — 이벤트 버블 차단(드래그 핸들과 충돌 방지) · 2026-04-27: summary 제거 (Generate 와 통일) */}
        <div onClick={(e) => e.stopPropagation()}>
          <ResultHoverActionBar hovered={hovered}>
            <ActionBarButton
              icon="zoom-in"
              title="크게 보기"
              onClick={onExpand}
            />
            <ActionBarButton
              icon="download"
              title="저장"
              onClick={() =>
                downloadImage(
                  afterItem.imageRef,
                  filenameFromRef(
                    afterItem.imageRef,
                    `ais-edit-${afterItem.id}.png`,
                  ),
                )
              }
            />
            <ActionBarButton
              icon="edit"
              title="이 결과를 다음 수정의 원본으로"
              onClick={() => {
                useEditStore
                  .getState()
                  .setSource(
                    afterItem.imageRef,
                    `${afterItem.label} · ${afterItem.width}×${afterItem.height}`,
                    afterItem.width,
                    afterItem.height,
                  );
                onAfterIdReset();
                toast.info("원본으로 지정", afterItem.label);
              }}
            />
            <ActionBarButton
              icon="refresh"
              title="수정 설정 복원 (다시)"
              onClick={() => {
                const s = useEditStore.getState();
                s.setPrompt(afterItem.prompt);
                s.setLightning(afterItem.lightning);
                toast.info("수정 설정 복원", "[수정 생성] 눌러");
              }}
            />
          </ResultHoverActionBar>
        </div>
      </div>
    </div>
  );
}
