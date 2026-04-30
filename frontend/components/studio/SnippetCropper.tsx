/**
 * SnippetCropper — react-easy-crop 격리 컴포넌트.
 *
 * 2026-04-30 (Phase 2A Task 4 · plan 2026-04-30-prompt-snippets-library.md).
 *
 * 분리 목적:
 *  - react-easy-crop 은 SSR 환경에서 동작 안 함 (window 의존)
 *  - SnippetRegisterModal 이 `dynamic({ ssr: false })` 로 이 컴포넌트 호출 → SSR 격리
 *  - ReferenceImageBox 는 이미 "use client" 렌더 시점부터 client-only — 다른 흐름
 */

"use client";

import { useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import type { CropArea } from "@/stores/useEditStore";

interface Props {
  /** data URL (사용자 업로드 이미지) */
  image: string;
  /** crop 영역 변경 콜백 — null 이면 미적용 (원본). */
  onCropArea: (area: CropArea | null) => void;
  /** Cropper container 높이 (기본 240) */
  height?: number;
}

/** 카드 썸네일 = 정사각형 1:1 고정 (라이브러리 grid 와 일치) */
const ASPECT = 1;
/** 너무 작은 영역은 무효 처리 (기본 96px — 썸네일이라 256 까지는 불필요) */
const MIN_THUMB_PX = 96;

export default function SnippetCropper({
  image,
  onCropArea,
  height = 240,
}: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  // 2026-04-30 (codex review fix · Nit): 96px 미만 → 원본 저장 fallback 인 걸
  // 사용자에게 명시. 안 보이면 "crop 적용됐다" 오해 위험.
  const [tooSmall, setTooSmall] = useState(false);

  const handleCropComplete = (_area: Area, areaPixels: Area) => {
    if (
      areaPixels.width < MIN_THUMB_PX ||
      areaPixels.height < MIN_THUMB_PX
    ) {
      setTooSmall(true);
      onCropArea(null);
      return;
    }
    setTooSmall(false);
    onCropArea(areaPixels);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height,
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--surface-2, var(--bg-2))",
        }}
      >
        <Cropper
          image={image}
          crop={crop}
          zoom={zoom}
          aspect={ASPECT}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={handleCropComplete}
          objectFit="contain"
          minZoom={1}
          maxZoom={3}
          zoomSpeed={0.25}
          style={{
            cropAreaStyle: {
              color: "rgba(0, 0, 0, 0.75)",
            },
          }}
        />
      </div>
      <div
        role="status"
        aria-live="polite"
        style={{
          fontSize: 11,
          color: tooSmall ? "#b42318" : "var(--ink-4)",
          minHeight: 14,
        }}
      >
        {tooSmall
          ? `⚠ 선택 영역이 ${MIN_THUMB_PX}px 미만이라 원본이 저장돼요.`
          : "마우스 드래그/휠로 영역 조정 (1:1 정사각)"}
      </div>
    </div>
  );
}
