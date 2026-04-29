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

import { useState } from "react";
import BeforeAfterSlider from "@/components/studio/BeforeAfterSlider";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";
import { SegControl } from "@/components/ui/primitives";
import type { HistoryItem } from "@/lib/api/types";
import { downloadImage, filenameFromRef } from "@/lib/image-actions";
import { useEditStore } from "@/stores/useEditStore";
import { toast } from "@/stores/useToastStore";

type EditViewerMode = "slider" | "sidebyside";

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
  // 슬라이더 정합 fix (2026-04-29): 컨테이너 비율 = After (수정본) 자연 비율.
  //
  // 옛 동작: 원본 (sourceWidth/Height) 비율 컨테이너 + 둘 다 contain
  //   → ComfyUI FluxKontextImageScale 가 결과를 megapixel 정렬로 미세 리사이즈하면
  //     After 가 letterbox 되고 인물이 컨테이너 가운데로 옮겨져 Before 와 좌표 어긋남.
  //
  // 새 동작: After 비율 컨테이너 + Before 만 cover (한 축 fit + 가운데 정렬)
  //   → After 는 풀필 (자기 비율), Before 는 짧은 축 기준 fit + 긴 축 미세 잘림
  //   → 인물/피사체가 같은 좌표계에 떨어져 슬라이더 핸들로 자연스럽게 변화 비교 가능.
  //
  // fallback chain: After → 원본 → 16/10 (옛 row 호환).
  const aspectRatio =
    afterItem.width && afterItem.height
      ? `${afterItem.width} / ${afterItem.height}`
      : sourceWidth && sourceHeight
        ? `${sourceWidth} / ${sourceHeight}`
        : "16 / 10";

  // 비교 모드 — 슬라이더(기본) / 나란히. 세션 한정 (영속 X · 새로고침 시 slider 복귀).
  const [viewerMode, setViewerMode] = useState<EditViewerMode>("slider");

  // 액션바 — 두 모드 공통 (slider 는 슬라이더 위, sidebyside 는 결과 이미지 위에서만).
  const actionBarChildren = (
    <>
      <ActionBarButton icon="zoom-in" title="크게 보기" onClick={onExpand} />
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
    </>
  );

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        // 2026-04-27 매트 카드 (Generate 와 통일): 카드 안 padding → 슬라이더가 떠있는 느낌.
        // dot grid 배경 + boxShadow + border (액자). BeforeAfter 자체 dimensions 보존.
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 10,
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
      {/* 모드 토글 — 우측 상단. CompareViewer 와 통일 (2026-04-27 오빠 피드백). */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <SegControl
          value={viewerMode}
          onChange={(v) => setViewerMode(v as EditViewerMode)}
          options={[
            { value: "slider", label: "슬라이더" },
            { value: "sidebyside", label: "나란히" },
          ]}
        />
      </div>

      {viewerMode === "slider" ? (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              position: "relative",
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
              beforeFit="cover"
            />
            <div onClick={(e) => e.stopPropagation()}>
              <ResultHoverActionBar hovered={hovered}>
                {actionBarChildren}
              </ResultHoverActionBar>
            </div>
          </div>
        </div>
      ) : (
        <SideBySidePanel
          beforeSrc={sourceImage}
          afterItem={afterItem}
          aspectRatio={aspectRatio}
          hovered={hovered}
          actionBarChildren={actionBarChildren}
        />
      )}
    </div>
  );
}

/** 나란히 모드 — Before / After 두 그리드. 호버 액션바는 After 위에만. */
function SideBySidePanel({
  beforeSrc,
  afterItem,
  aspectRatio,
  hovered,
  actionBarChildren,
}: {
  beforeSrc: string;
  afterItem: HistoryItem;
  aspectRatio: string;
  hovered: boolean;
  actionBarChildren: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        maxHeight: "70vh",
      }}
    >
      <SideThumb src={beforeSrc} label="Before" aspectRatio={aspectRatio} />
      <div style={{ position: "relative" }}>
        <SideThumb
          src={afterItem.imageRef}
          label="After"
          aspectRatio={aspectRatio}
        />
        <div onClick={(e) => e.stopPropagation()}>
          <ResultHoverActionBar hovered={hovered}>
            {actionBarChildren}
          </ResultHoverActionBar>
        </div>
      </div>
    </div>
  );
}

function SideThumb({
  src,
  label,
  aspectRatio,
}: {
  src: string;
  label: "Before" | "After";
  aspectRatio: string;
}) {
  const isAfter = label === "After";
  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-2)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,.06)",
        boxShadow:
          "0 10px 32px rgba(0,0,0,.14), 0 3px 10px rgba(0,0,0,.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        aspectRatio,
        maxHeight: "70vh",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
      <span
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          fontSize: 10.5,
          fontWeight: 700,
          padding: "3px 8px",
          borderRadius: "var(--radius-full)",
          background: isAfter ? "rgba(34,197,94,.92)" : "rgba(59,130,246,.92)",
          color: "#fff",
          letterSpacing: ".04em",
          textTransform: "uppercase",
          backdropFilter: "blur(4px)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
