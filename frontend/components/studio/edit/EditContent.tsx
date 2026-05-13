/**
 * EditContent — Edit 페이지 결과 본문 (Before/After 슬라이더 + 호버 액션바).
 *
 * 2026-04-26: edit/page.tsx 분해 step 2.
 *  - Generate 의 GenerateResultViewer 패턴과 통일 (호버 props + 콜백)
 *  - 단순 액션 (Download / UseAsSource / Reuse) 은 store 직접 호출 — page 슬림화
 *  - 외부 영향 액션 (Lightbox open / Comparison detail) 만 콜백
 *
 * 2026-05-02 디자인 V5 Phase 5 격상:
 *  - 매트지 wrapper 는 ResultBox 로 이관
 *  - SegControl wrapper → className `.ais-hero-seg-row`
 *  - **Action Bar 4 버튼** — download 제거 + copy 신규 (자세히 / 수정 지시 복사 / 다음 수정 원본 / 리프레시)
 *  - **canPromote=true 시 5번째 액션 "라이브러리 저장"** 유지 필수 (회귀 위험 #5)
 *  - Caption 은 ResultBox 밖에서 page 가 done 상태일 때만 렌더
 *  - **회귀 위험 #4 보존**: BeforeAfterSlider 자체 드래그 핸들 (별도 컴포넌트 — 변경 0)
 *  - inner box (BeforeAfter wrapper) inline 제거 — BeforeAfterSlider 자체 box-shadow 가 처리
 *
 * 조건부 렌더는 부모 (EditRightPanel) 가 담당 — 이 컴포넌트는 항상 afterItem 보유 가정.
 */

"use client";

import { useEffect, useState } from "react";
import BeforeAfterSlider from "@/components/studio/BeforeAfterSlider";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";
import { SegControl } from "@/components/ui/primitives";
import type { HistoryItem } from "@/lib/api/types";
import { copyText } from "@/lib/image-actions";
import { useEditStore } from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";

import ReferencePromoteModal from "./ReferencePromoteModal";

// v9 (2026-04-29 · Phase C.2): 사용자 직접 업로드 reference 의 임시 풀 URL prefix.
// canPromote 판정에 사용 — STUDIO_BASE 절대 URL 화 후에도 substring 매칭으로 검출.
const POOL_URL_SUBSTRING = "/images/studio/reference-pool/";

type EditViewerMode = "slider" | "sidebyside";

interface Props {
  afterItem: HistoryItem;
  /** 짝 일치한 원본 이미지 (afterItem.sourceRef === sourceImage 통과한 후) */
  sourceImage: string;
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

export default function EditContent({
  afterItem,
  sourceImage,
  compareX,
  setCompareX,
  hovered,
  onEnter,
  onLeave,
  onExpand,
  onAfterIdReset,
}: Props) {
  // 2026-05-03: Compare 와 동일 패턴 — sourceImage 직접 디코드해 *진짜 Before 비율* 측정.
  //   배경: store 의 sourceWidth/Height 가 EditRightPanel:153 의 setSource(it.width, it.height)
  //   버그로 *After 사이즈* 가 잘못 저장됨 → 옛 fallback chain 은 wrapper 비율을 After 로 잡아
  //   Before(원본) 가 letterbox 되며 슬라이더 좌우가 어긋나 보였음.
  //   Compare (CompareViewer:144) 는 imageA.width/height 가 본래 정확해서 정합 OK 였던 것.
  // 2026-05-06 리팩토링 (Codex finding 1):
  //   src 를 측정 결과에 포함 → 렌더 시 현재 sourceImage 와 일치할 때만 사용.
  //   즉시 setSourceNat(null) 호출 제거 (react-hooks/set-state-in-effect 회귀 fix).
  //   cancelled flag 로 stale 결과 race 차단.
  // fallback: 측정 끝나기 전엔 afterItem 비율 → 16/10.
  const [sourceNat, setSourceNat] = useState<{ src: string; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!sourceImage) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setSourceNat({ src: sourceImage, w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = sourceImage;
    return () => {
      cancelled = true;
    };
  }, [sourceImage]);
  // 옛 결과 (src !== sourceImage) 는 무시 → fallback 으로.
  const matchedNat = sourceNat && sourceNat.src === sourceImage ? sourceNat : null;
  const aspectRatio = matchedNat
    ? `${matchedNat.w} / ${matchedNat.h}`
    : afterItem.width && afterItem.height
      ? `${afterItem.width} / ${afterItem.height}`
      : "16 / 10";
  const maxViewerWidth = "min(100%, 1040px)";

  // 2026-05-02: 둘 다 contain 으로. ComfyUI 결과 미세 비율 차이 (~4%) 는 transform 보정 시도했으나
  // 사용자 시각 인지 영역 밑이라 fix 빼고 그대로 contain 처리. (autoMatchAspect 시도 → 인물 약간 어색)

  // 비교 모드 — 슬라이더(기본) / 나란히. 세션 한정 (영속 X · 새로고침 시 slider 복귀).
  const [viewerMode, setViewerMode] = useState<EditViewerMode>("slider");

  // v9 (2026-04-29 · Phase C.2): 사후 라이브러리 저장 모달 트리거.
  // canPromote: history.referenceRef 가 *임시 풀 URL substring 매칭* 일 때만 노출. (회귀 위험 #5)
  const [promoteOpen, setPromoteOpen] = useState(false);
  const canPromote =
    !!afterItem.referenceRef &&
    afterItem.referenceRef.includes(POOL_URL_SUBSTRING);

  const updateReferenceRef = useHistoryStore((s) => s.updateReferenceRef);

  // V5 Action Bar — 4 버튼 (download 제거 → copy 신규) + canPromote=true 시 5번째 "라이브러리 저장"
  const actionBarChildren = (
    <>
      <ActionBarButton icon="zoom-in" title="크게 보기" onClick={onExpand} />
      <ActionBarButton
        icon="copy"
        title="수정 지시 복사"
        onClick={() => void copyText(afterItem.prompt || "", "수정 지시")}
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
      {canPromote && (
        <ActionBarButton
          icon="grid"
          title="📚 참조 라이브러리에 저장"
          onClick={() => setPromoteOpen(true)}
        />
      )}
    </>
  );

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        maxWidth: maxViewerWidth,
        marginInline: "auto",
      }}
    >
      {/* 모드 토글 — 우측 상단. CompareViewer 와 통일 (2026-04-27 오빠 피드백). */}
      <div className="ais-hero-seg-row">
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
        <div style={{ display: "grid", justifyItems: "center", width: "100%" }}>
          <div style={{ position: "relative", width: "100%" }}>
            <BeforeAfterSlider
              beforeSrc={sourceImage}
              afterSeed={afterItem.imageRef || afterItem.id}
              afterSrc={afterItem.imageRef}
              compareX={compareX}
              setCompareX={setCompareX}
              aspectRatio={aspectRatio}
              beforeFit="contain"
              afterFit="contain"
            />
            <div onClick={(e) => e.stopPropagation()}>
              <ResultHoverActionBar hovered={hovered} variant="hero">
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
          maxWidth={maxViewerWidth}
          beforeFit="cover"
        />
      )}

      {/* v9 (2026-04-29 · Phase C.2): 사후 라이브러리 저장 모달 */}
      {canPromote && (
        <ReferencePromoteModal
          historyId={afterItem.id}
          open={promoteOpen}
          onClose={() => setPromoteOpen(false)}
          onSuccess={(newReferenceRef) => {
            // promote 성공 시 store 의 referenceRef 를 영구 URL 로 swap →
            // canPromote 자동 false → ActionBar 의 promote 버튼 사라짐 (Codex I3).
            updateReferenceRef(afterItem.id, newReferenceRef);
          }}
        />
      )}
    </div>
  );
}

/** 나란히 모드 — Before / After 두 그리드. 호버 액션바는 After 위에만.
 *  2026-04-29: 슬라이더와 동일한 정합 fix — Before 만 cover (After 는 자기 비율 = 컨테이너 비율).
 */
function SideBySidePanel({
  beforeSrc,
  afterItem,
  aspectRatio,
  hovered,
  actionBarChildren,
  maxWidth,
  beforeFit = "contain",
}: {
  beforeSrc: string;
  afterItem: HistoryItem;
  aspectRatio: string;
  hovered: boolean;
  actionBarChildren: React.ReactNode;
  maxWidth: string;
  beforeFit?: "contain" | "cover";
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        width: "100%",
        maxWidth,
        maxHeight: "70vh",
        marginInline: "auto",
      }}
    >
      <SideThumb
        src={beforeSrc}
        label="Before"
        aspectRatio={aspectRatio}
        fit={beforeFit}
      />
      <div style={{ position: "relative" }}>
        <SideThumb
          src={afterItem.imageRef}
          label="After"
          aspectRatio={aspectRatio}
          fit="cover"
        />
        <div onClick={(e) => e.stopPropagation()}>
          <ResultHoverActionBar hovered={hovered} variant="hero">
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
  fit = "contain",
}: {
  src: string;
  label: "Before" | "After";
  aspectRatio: string;
  fit?: "contain" | "cover";
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
          objectFit: fit,
          objectPosition: "center",
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
