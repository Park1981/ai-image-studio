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
import type { HistoryItem } from "@/lib/api-client";
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
        // 바깥 wrapper — 섹션 가로 꽉 + BeforeAfter 가운데 정렬.
        // BeforeAfter 는 aspectRatio + maxHeight 70vh 때문에 세로형 이미지일 땐
        // width 가 height × ratio 로 축소됨. flex center 로 뷰어 가운데 정렬.
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}
    >
      {/* 내부 wrapper — BeforeAfter 와 크기가 같아 액션바가 이미지 하단에만 깔림 */}
      <div style={{ position: "relative" }}>
        <BeforeAfterSlider
          beforeSrc={sourceImage}
          afterSeed={afterItem.imageRef || afterItem.id}
          compareX={compareX}
          setCompareX={setCompareX}
          aspectRatio={aspectRatio}
        />
        {/* 호버 액션바 — 이벤트 버블 차단(드래그 핸들과 충돌 방지) */}
        <div onClick={(e) => e.stopPropagation()}>
          <ResultHoverActionBar
            hovered={hovered}
            summary={
              <div
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontSize: 12,
                  }}
                  title={afterItem.prompt}
                >
                  {afterItem.prompt}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    color: "rgba(255,255,255,.72)",
                    letterSpacing: ".04em",
                    flexShrink: 0,
                  }}
                >
                  {afterItem.width}×{afterItem.height}
                </span>
              </div>
            }
          >
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
