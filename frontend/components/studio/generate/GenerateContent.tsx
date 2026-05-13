/**
 * GenerateContent — Generate 페이지 결과 이미지 본문 + 호버 액션바.
 *
 * 2026-04-26 (task #5): generate/page.tsx 에서 별도 파일로 분리.
 * 2026-04-27 (UX 폴리시):
 *  - summary 제거 (프롬프트 요약 안 보임 — 버튼 그룹만 통통 튀듯 등장)
 *  - 복사 버튼 → 프롬프트 복사 (이미지 복사 → 텍스트 클립보드)
 *  - 매트지 효과 (카드 padding 24 + 이미지 자체 그림자)
 *  - dot grid 배경 (Figma 캔버스 톤)
 *  - hover-only wheel zoom (1.0~4.0) + drag pan + 더블클릭 reset
 *
 * 2026-05-02 디자인 V5 Phase 4 격상:
 *  - **Action Bar 4 버튼** — download 제거 (자세히 / 복사 / 수정 / 리프레시)
 *  - Caption 은 ResultBox 밖에서 page 가 done 상태일 때만 렌더
 *  - **회귀 위험 #2 보존**: Hero wheel zoom + drag pan + dbl-click reset (line 81~143 그대로)
 *  - Hero 외곽/비율은 ResultBox 가 담당
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoryItem } from "@/lib/api/types";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";

interface Props {
  item: HistoryItem;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onExpand: () => void;
  /** 프롬프트 텍스트 클립보드 복사 */
  onCopyPrompt: () => void;
  onSendToEdit: () => void;
  onReuse: () => void;
}

const SCALE_MIN = 1;
const SCALE_MAX = 4;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export default function GenerateContent({
  item,
  hovered,
  onEnter,
  onLeave,
  onExpand,
  onCopyPrompt,
  onSendToEdit,
  onReuse,
}: Props) {
  /* ── zoom / pan state ── */
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  /* ── item 바뀌면 zoom/pan reset (React 19 권장 — render 중 prev 비교) ── */
  const [prevItemId, setPrevItemId] = useState(item.id);
  if (prevItemId !== item.id) {
    setPrevItemId(item.id);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  /* ── hover-only wheel zoom (native addEventListener · passive:false) ── */
  /* ── 회귀 위험 #2 보존: 이 useEffect + onMouseDown + onDoubleClick 블록은 V5 격상에도 변경 X. ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      // hover 영역 안 wheel = zoom (페이지 스크롤 차단)
      // 마우스가 영역 밖이면 native 페이지 스크롤 정상 동작
      e.preventDefault();
      // wheel up (deltaY < 0) → zoom in / wheel down → zoom out
      // 비례 scale (현재값 × delta) → 어디서든 비슷한 체감 속도
      const factor = 1 - e.deltaY * 0.0015;
      setScale((prev) => {
        const next = clamp(prev * factor, SCALE_MIN, SCALE_MAX);
        // scale 1 로 돌아가면 offset 도 reset (다시 매트 가운데 정렬)
        if (next <= SCALE_MIN + 0.001) {
          setOffset({ x: 0, y: 0 });
        }
        return next;
      });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  /* ── drag pan (window mousemove/mouseup) ── */
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      setOffset({
        x: start.offsetX + (e.clientX - start.clientX),
        y: start.offsetY + (e.clientY - start.clientY),
      });
    };
    const onUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  const onMouseDown = (e: React.MouseEvent) => {
    // scale 1 일 때는 pan 의미 X → drag 안 시작
    if (scale <= SCALE_MIN) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
  };

  const onDoubleClick = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  /* ── cursor 분기 ── */
  const cursor =
    scale > SCALE_MIN
      ? isDragging
        ? "grabbing"
        : "grab"
      : "default";

  return (
    <div
      ref={containerRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        cursor,
        touchAction: "none",
      }}
      title={
        scale > SCALE_MIN
          ? "드래그로 이동 · 더블클릭으로 100% 복원"
          : "휠로 확대/축소"
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="ais-result-hero-img"
        src={item.imageRef}
        alt={item.label}
        draggable={false}
        style={{
          // 동적 — zoom + pan transform · drag 중엔 transition off
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: isDragging ? "none" : "transform .18s ease-out",
          // 비표준 Webkit user-drag 만 inline (표준 user-select / pointer-events 는 CSS 가 처리)
          // @ts-expect-error — 비표준 Webkit
          WebkitUserDrag: "none",
        }}
      />

      {/* 하단 호버 액션바 — V5 4 버튼 (download 제거 · 자세히/복사/수정/리프레시) */}
      <div onClick={(e) => e.stopPropagation()}>
        <ResultHoverActionBar hovered={hovered} variant="hero">
          <ActionBarButton
            icon="zoom-in"
            title="크게 보기"
            onClick={onExpand}
          />
          <ActionBarButton
            icon="copy"
            title="프롬프트 복사"
            onClick={onCopyPrompt}
          />
          <ActionBarButton
            icon="edit"
            title="수정으로"
            onClick={onSendToEdit}
          />
          <ActionBarButton
            icon="refresh"
            title="재생성 (파라미터 복원)"
            onClick={onReuse}
          />
        </ResultHoverActionBar>
      </div>
    </div>
  );
}
