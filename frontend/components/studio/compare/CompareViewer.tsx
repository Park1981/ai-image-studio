/**
 * CompareViewer — /vision/compare 우 상단 비교 뷰어.
 * 2026-04-27 (C2-P1-1): vision/compare/page.tsx 분해 — 페이지에서 추출.
 *
 * 헤더 (모드 토글 + 비율 차이 경고) + 본문 분기:
 *   - 둘 다 비어있으면 EmptyViewer
 *   - 슬라이더 모드: BeforeAfterSlider (A=before, B=after) — V5 labelVariant="ab" violet/amber 그라데이션
 *   - 나란히 모드: 두 SideThumb 그리드
 *
 * 2026-05-02 디자인 V5 Phase 7 격상:
 *  - BeforeAfterSlider 호출 시 `labelVariant="ab"` 명시 (Phase 5 nit #1 박제 활용)
 *  - 외곽 wrapper / 헤더 / 비율 chip 옛 inline 그대로 (plan §7 명시 X — 회귀 0)
 *  - 회귀 위험 #4 (BeforeAfterSlider 드래그) Phase 5 에서 보존됨 — Compare 도 자동 호환
 */

"use client";

import BeforeAfterSlider from "@/components/studio/BeforeAfterSlider";
import {
  CompareSlotBadge,
} from "@/components/studio/CompareImageSlot";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import { SegControl } from "@/components/ui/primitives";
import type { VisionCompareImage } from "@/stores/useVisionCompareStore";

type ViewerMode = "slider" | "sidebyside";

interface ViewerPanelProps {
  imageA: VisionCompareImage | null;
  imageB: VisionCompareImage | null;
  mode: ViewerMode;
  onModeChange: (m: ViewerMode) => void;
}

export default function CompareViewer({
  imageA,
  imageB,
  mode,
  onModeChange,
}: ViewerPanelProps) {
  const both = !!imageA && !!imageB;

  // 비율 차이 감지 — 10% 이상 다르면 슬라이더 비추천 (사용자에게만 안내)
  const ratioDiverges =
    both &&
    imageA &&
    imageB &&
    Math.abs(imageA.width / imageA.height - imageB.width / imageB.height) /
      (imageA.width / imageA.height) >
      0.1;

  return (
    <div
      className="ais-result-hero ais-result-hero-edit"
      style={{
        // 동적 보존: minHeight 304 (Compare 시각 cap · plan §9 박제).
        // 나머지 (background/border/radius/padding/flex column/gap) 는 className 의
        // .ais-result-hero + .ais-result-hero-edit 가 처리.
        // -edit modifier 의 align-items:stretch 가 SliderViewer/SideBySideViewer
        // inner wrapper 폭 100% 자동 보장 → 좁음 fix 의 핵심 메커니즘.
        minHeight: 304,
      }}
    >
      {/* 2026-05-03: 페이지 레벨에 StudioResultHeader 추가됨 → 자체 "비교 뷰어" 라벨 제거.
       *  비율 경고 (amber chip) 는 좌측에, SegControl 은 우측에. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minHeight: 28,
          }}
        >
          {ratioDiverges && mode === "slider" && (
            <span
              style={{
                fontSize: 10,
                color: "var(--amber-ink)",
                fontWeight: 500,
                background: "var(--amber-soft)",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              비율이 달라요 — 나란히 권장
            </span>
          )}
        </div>
        <SegControl
          disabled={!both}
          value={mode}
          onChange={(v) => onModeChange(v as ViewerMode)}
          options={[
            { value: "slider", label: "슬라이더" },
            { value: "sidebyside", label: "나란히" },
          ]}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {!both ? (
          <EmptyViewer />
        ) : mode === "slider" ? (
          <SliderViewer imageA={imageA!} imageB={imageB!} />
        ) : (
          <SideBySideViewer imageA={imageA!} imageB={imageB!} />
        )}
      </div>
    </div>
  );
}

function EmptyViewer() {
  return (
    <StudioEmptyState
      size="panel"
      icon="image"
      title="이미지 A 와 B 를 모두 업로드하면 비교가 시작됩니다"
      description="좌측 패널에서 두 슬롯을 채워 주세요"
    />
  );
}

function SliderViewer({
  imageA,
  imageB,
}: {
  imageA: VisionCompareImage;
  imageB: VisionCompareImage;
}) {
  // 비율은 A 기준 (B 는 contain 으로 박스 안에서 알아서 맞춰짐)
  // /edit 패턴: 바깥 flex center + 안쪽 BeforeAfterSlider · maxHeight 기본 70vh
  const aspect = `${imageA.width} / ${imageA.height}`;
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <div style={{ position: "relative" }}>
        <BeforeAfterSlider
          beforeSrc={imageA.dataUrl}
          afterSeed="vision-compare"
          afterSrc={imageB.dataUrl}
          aspectRatio={aspect}
          beforeLabel="A"
          afterLabel="B"
          labelVariant="ab"
        />
      </div>
    </div>
  );
}

function SideBySideViewer({
  imageA,
  imageB,
}: {
  imageA: VisionCompareImage;
  imageB: VisionCompareImage;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        // 가로 두 칸이라 박스 한 개당 가로 = 절반 → aspectRatio 로 높이 자동
        // 전체 컨테이너에 maxHeight 70vh 보장 (편집 페이지와 동일)
        maxHeight: "70vh",
      }}
    >
      <SideThumb img={imageA} badge="A" aspectRatio={`${imageA.width} / ${imageA.height}`} />
      <SideThumb img={imageB} badge="B" aspectRatio={`${imageB.width} / ${imageB.height}`} />
    </div>
  );
}

function SideThumb({
  img,
  badge,
  aspectRatio,
}: {
  img: VisionCompareImage;
  badge: "A" | "B";
  aspectRatio: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        // 검은 배경 제거 — warm neutral 로 변경 (이미지 contain 시 여백이 자연스럽게 어울림)
        background: "var(--bg-2)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        border: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        aspectRatio,
        maxHeight: "70vh",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.dataUrl}
        alt={badge}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
      <CompareSlotBadge floating>{badge}</CompareSlotBadge>
    </div>
  );
}
