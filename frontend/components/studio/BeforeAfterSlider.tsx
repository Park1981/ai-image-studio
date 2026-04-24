/**
 * BeforeAfterSlider — Before/After 드래그 비교 슬라이더.
 * 2026-04-24 · /edit 페이지에서 공용 추출 (2차: Lightbox 에서도 재사용).
 *
 * Features:
 *  - 수직 드래그 핸들로 좌/우 영역 비율 조정
 *  - Before 가 data: URL 이면 실제 <img>, 아니면 seed 기반 ImageTile (placeholder)
 *  - compareX 는 optional props — 없으면 내부 state 로 독립 관리
 *
 * 사용처: /edit 메인 뷰어, ImageLightbox 비교 모드.
 */

"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import ImageTile from "@/components/ui/ImageTile";
import Icon from "@/components/ui/Icon";

interface Props {
  beforeSrc: string;
  afterSeed: string;
  /**
   * After 측 실제 이미지 URL (data: 또는 절대 URL). 주면 ImageTile 대신 <img>.
   * 미전달 시 기존 동작 (afterSeed 기반 ImageTile placeholder) 유지 — Edit 호출자 무영향.
   */
  afterSrc?: string;
  /** 원본 이미지 실제 비율 (예: "1920 / 1080"). 없으면 16:10 폴백. */
  aspectRatio?: string;
  /** compareX (0~100). props 로 주면 제어 모드, 없으면 내부 state (비제어). */
  compareX?: number;
  setCompareX?: (v: number) => void;
  /** 최대 높이 CSS 값 (기본 "70vh"). Lightbox 등에선 "none" 으로 해제 가능. */
  maxHeight?: string;
  /** 코너 라벨 커스터마이징 (기본 Before/After). */
  beforeLabel?: string;
  afterLabel?: string;
}

export default function BeforeAfterSlider({
  beforeSrc,
  afterSeed,
  afterSrc,
  aspectRatio = "16 / 10",
  compareX: controlledCompareX,
  setCompareX: controlledSetCompareX,
  maxHeight = "70vh",
  beforeLabel = "Before",
  afterLabel = "After",
}: Props) {
  // 비제어 fallback — 부모가 state 안 주면 내부에서 관리 (기본 50%).
  const [internalCompareX, setInternalCompareX] = useState(50);
  const compareX = controlledCompareX ?? internalCompareX;
  const setCompareX = controlledSetCompareX ?? setInternalCompareX;

  const wrapRef = useRef<HTMLDivElement>(null);

  const onDrag = (clientX: number) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setCompareX(Math.max(2, Math.min(98, pct)));
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault(); // 브라우저 기본 이미지 드래그·텍스트 선택 차단
    // 드래그 동안 전역 user-select 잠궈 화면 어디로 가든 하이라이트 안 생기게
    const prevBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const move = (evt: MouseEvent) => onDrag(evt.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevBodyUserSelect;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // before: data URL 이면 <img contain>, 아니면 seed 기반 ImageTile
  const renderBefore = beforeSrc.startsWith("data:") ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={beforeSrc}
      alt="before"
      draggable={false} // 기본 이미지 고스트 드래그 방지
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        display: "block",
        // @ts-expect-error — 비표준 Webkit 속성
        WebkitUserDrag: "none",
        userSelect: "none",
      }}
    />
  ) : (
    <ImageTile
      seed={beforeSrc}
      aspect={aspectRatio}
      style={{ width: "100%", height: "100%", borderRadius: 0 }}
    />
  );

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        background: "var(--bg-2)",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--line)",
        aspectRatio,
        maxHeight,
        // 슬라이더 전 영역에서 텍스트·이미지 선택 UI 발생 억제
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* After (full) — afterSrc 가 data:/URL 이면 <img>, 아니면 seed 기반 ImageTile */}
      {afterSrc && (afterSrc.startsWith("data:") || afterSrc.startsWith("http") || afterSrc.startsWith("/")) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={afterSrc}
          alt="after"
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            // @ts-expect-error — 비표준 Webkit 속성
            WebkitUserDrag: "none",
            userSelect: "none",
          }}
        />
      ) : (
        <ImageTile
          seed={afterSeed}
          aspect={aspectRatio}
          style={{ width: "100%", height: "100%", borderRadius: 0 }}
        />
      )}
      {/* Before (clipped) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `inset(0 ${100 - compareX}% 0 0)`,
        }}
      >
        {renderBefore}
      </div>

      <CornerBadge pos="tl">{beforeLabel}</CornerBadge>
      <CornerBadge pos="tr">{afterLabel}</CornerBadge>

      <div
        onMouseDown={startDrag}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${compareX}%`,
          width: 2,
          background: "#fff",
          transform: "translateX(-1px)",
          cursor: "ew-resize",
          boxShadow: "0 0 0 1px rgba(0,0,0,.15)",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,.2)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-2)",
          }}
        >
          <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
            <Icon
              name="chevron-right"
              size={12}
              style={{ transform: "rotate(180deg)" }}
            />
            <Icon name="chevron-right" size={12} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CornerBadge({
  pos,
  children,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  children: ReactNode;
}) {
  const p: Record<string, CSSProperties> = {
    tl: { top: 10, left: 10 },
    tr: { top: 10, right: 10 },
    bl: { bottom: 10, left: 10 },
    br: { bottom: 10, right: 10 },
  };
  return (
    <div
      className="mono"
      style={{
        position: "absolute",
        ...p[pos],
        fontSize: 10,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: "#fff",
        background: "rgba(0,0,0,.55)",
        backdropFilter: "blur(4px)",
        padding: "3px 8px",
        borderRadius: 4,
      }}
    >
      {children}
    </div>
  );
}
