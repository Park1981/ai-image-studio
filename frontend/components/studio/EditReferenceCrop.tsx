/**
 * EditReferenceCrop — Multi-reference image2 의 인라인 수동 crop UI.
 *
 * 2026-04-28 (수동 crop UI · Phase 1).
 *
 * 동기:
 *   gemma4 가 정확한 prompt 를 만들어도 Qwen Edit 가 image2 를 broad reference
 *   로 처리해 의상/배경이 결과에 누수되는 문제 (`edit-153d2c13` 검증).
 *   해결책: 사용자가 *직접* 영역을 잘라 image2 를 *해당 영역만* 으로 만든다 →
 *   ComfyUI multi-ref 가 받는 image2 자체가 의도된 영역 한정 → 누수 가능성 제거.
 *
 * UX:
 *   1. multi-ref 토글 ON + image2 업로드 → 즉시 본 컴포넌트 노출 (모달 X · 인라인)
 *   2. default 박스 = 이미지 전체 (zoom 1.0)
 *   3. 자유 pan/zoom (드래그 + 휠) + 비율 lock 토글 4개 (자유/1:1/4:3/9:16)
 *   4. 확정 버튼 없음 — "수정 생성" 클릭 시점에 그 박스가 그대로 적용
 *   5. 256px 미만 영역은 onAreaChange(null) 로 무효 처리 (원본 그대로)
 *
 * Props:
 *   imageSrc:    image source URL (data URL 또는 ObjectURL · 호출자 보장)
 *   onAreaChange: 영역 변경 시 호출 — useEditStore.setReferenceCropArea 와 직결
 *   bypassCrop:  true 면 crop UI 숨김 + 미리보기만 (라이브러리 plan 진입 시 사용)
 *
 * Note:
 *   - react-easy-crop 의 aspect 는 number (자유 비율 = 이미지 자연 비율 사용)
 *   - SSR 호환은 호출 측 (`next/dynamic` + ssr:false) 책임
 */

"use client";

import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area, MediaSize } from "react-easy-crop";

/** 비율 lock 모드 ID */
type AspectMode = "free" | "1:1" | "4:3" | "9:16";

interface AspectPreset {
  id: AspectMode;
  label: string;
  /** undefined = 자유 (이미지 자연 비율 사용) */
  ratio: number | undefined;
}

const ASPECT_PRESETS: AspectPreset[] = [
  { id: "free", label: "자유", ratio: undefined },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

/** crop 결과 박스 최소 크기 — 미만이면 무효 처리 (Qwen Edit 입력 품질 가드) */
const MIN_CROP_PX = 256;

interface Props {
  imageSrc: string;
  onAreaChange: (area: Area | null) => void;
  bypassCrop?: boolean;
}

export default function EditReferenceCrop({
  imageSrc,
  onAreaChange,
  bypassCrop = false,
}: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectMode, setAspectMode] = useState<AspectMode>("free");
  // 이미지의 자연 비율 — "자유" 모드일 때 cropper aspect 로 사용 (이미지 전체 박스)
  const [mediaAspect, setMediaAspect] = useState<number>(1);

  const aspectRatio =
    ASPECT_PRESETS.find((p) => p.id === aspectMode)?.ratio ?? mediaAspect;

  const handleCropComplete = useCallback(
    (_area: Area, areaPixels: Area) => {
      // 너무 작은 영역은 무효 — 원본 그대로 전송 (Qwen Edit 품질 가드)
      if (areaPixels.width < MIN_CROP_PX || areaPixels.height < MIN_CROP_PX) {
        onAreaChange(null);
        return;
      }
      onAreaChange(areaPixels);
    },
    [onAreaChange],
  );

  const handleMediaLoaded = useCallback((size: MediaSize) => {
    if (size.naturalWidth > 0 && size.naturalHeight > 0) {
      setMediaAspect(size.naturalWidth / size.naturalHeight);
    }
  }, []);

  // bypassCrop=true: 라이브러리 plan 진입 시 이미 crop 된 이미지 재 crop 방지.
  // 미리보기만 노출 (crop UI 숨김).
  if (bypassCrop) {
    return (
      <div
        data-testid="reference-crop-bypass"
        style={{
          position: "relative",
          width: "100%",
          maxHeight: 320,
          aspectRatio: "1 / 1",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--surface-2)",
        }}
      >
        {/* data URL/ObjectURL 미리보기 — next/image 최적화 대상 아님 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt="reference (already cropped)"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="reference-crop"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {/* 비율 lock 토글 chip */}
      <div
        data-testid="aspect-toggle"
        style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
      >
        {ASPECT_PRESETS.map((p) => {
          const active = aspectMode === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setAspectMode(p.id)}
              data-active={active}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "4px 10px",
                fontSize: 11.5,
                fontWeight: 600,
                borderRadius: "var(--radius-full)",
                border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                background: active ? "var(--accent-soft)" : "var(--bg)",
                color: active ? "var(--accent-ink)" : "var(--ink-2)",
                transition: "all .15s",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Cropper 컨테이너 — react-easy-crop 은 부모의 position:relative + 크기 필수 */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 320,
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--surface-2)",
        }}
      >
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspectRatio}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={handleCropComplete}
          onMediaLoaded={handleMediaLoaded}
          objectFit="contain"
          minZoom={1}
          maxZoom={3}
          zoomSpeed={0.25}
        />
      </div>

      {/* Zoom 슬라이더 — 휠과 별개로 명시적 조절 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          color: "var(--ink-3)",
        }}
      >
        <span>zoom</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          style={{ flex: 1 }}
          aria-label="zoom"
        />
        <span className="mono">{zoom.toFixed(2)}x</span>
      </div>

      {/* 도움말 */}
      <div style={{ fontSize: 10.5, color: "var(--ink-4)", lineHeight: 1.5 }}>
        드래그로 영역 이동 · 휠/슬라이더로 확대 · {MIN_CROP_PX}px 미만은 무효 처리
      </div>
    </div>
  );
}
