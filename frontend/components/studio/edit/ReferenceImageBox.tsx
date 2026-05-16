/**
 * ReferenceImageBox — 참조 이미지 (image2) 단일 박스 컴포넌트 (v9 · Phase B.1).
 *
 * 옛 SourceImageCard + EditReferenceCrop 의 *모든 기능 흡수* + 모드 분기 통합:
 *   - 드롭존 모드 (image === null): 드래그&드롭 + 클릭 + Ctrl+V paste
 *   - crop UI 모드 (bypassCrop=false): aspect preset 4종 + zoom slider + 256px guard
 *   - bypass 모드 (bypassCrop=true · 라이브러리 픽): 단순 미리보기 (crop 비활성)
 *
 * Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md (Phase B.1)
 */

"use client";

import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area, MediaSize } from "react-easy-crop";

import Icon from "@/components/ui/Icon";
import { useImagePasteTarget } from "@/hooks/useImagePasteTarget";
import { formatImageFileError, loadImageFile } from "@/lib/image-actions";

// ─────────────────────────────────────────────
// aspect preset (옛 EditReferenceCrop 흡수)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// CropArea (useEditStore.setReferenceCropArea 시그니처)
// ─────────────────────────────────────────────

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

interface Props {
  /** data: URL (사용자 업로드) 또는 절대 URL (라이브러리 픽) 또는 null (없음) */
  image: string | null;
  /** 이미지 변경 콜백 (null = 제거). label/w/h 는 옵셔널 — 새 업로드 시만 알 수 있음. */
  onImage: (
    image: string | null,
    label?: string,
    w?: number,
    h?: number,
  ) => void;
  /** crop 영역 변경 콜백 — useEditStore.setReferenceCropArea 와 직결 */
  onCropArea: (area: CropArea | null) => void;
  /** true = 라이브러리 픽 → crop 비활성 + 단순 미리보기 */
  bypassCrop?: boolean;
  /** 드롭존 placeholder 라벨 (기본: "참조 이미지를 업로드해 주세요") */
  placeholder?: string;
  /** Ctrl+V paste 호버 가드 — multi-slot 페이지에서 활성 슬롯만 응답 */
  pasteRequireHover?: boolean;
  /** 에러 토스트 콜백 — 호출자가 처리 */
  onError?: (message: string) => void;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function ReferenceImageBox({
  image,
  onImage,
  onCropArea,
  bypassCrop = false,
  placeholder = "참조 이미지를 업로드해 주세요",
  pasteRequireHover = false,
  onError,
}: Props) {
  // crop 모드 local state — 새 image 시 reset (key 기반은 부모 책임 — EditLeftPanel 의 key={referenceImage})
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspectMode, setAspectMode] = useState<AspectMode>("free");
  const [mediaAspect, setMediaAspect] = useState<number>(1);
  // 드롭존 호버 (paste 가드용)
  const [hovered, setHovered] = useState(false);
  // 드래그 오버 시각 피드백
  const [dragOver, setDragOver] = useState(false);

  const aspectRatio =
    ASPECT_PRESETS.find((p) => p.id === aspectMode)?.ratio ?? mediaAspect;

  // crop complete — 256px guard 적용 후 onCropArea 호출
  const handleCropComplete = useCallback(
    (_area: Area, areaPixels: Area) => {
      if (areaPixels.width < MIN_CROP_PX || areaPixels.height < MIN_CROP_PX) {
        onCropArea(null);
        return;
      }
      onCropArea(areaPixels);
    },
    [onCropArea],
  );

  const handleMediaLoaded = useCallback((size: MediaSize) => {
    if (size.naturalWidth > 0 && size.naturalHeight > 0) {
      setMediaAspect(size.naturalWidth / size.naturalHeight);
    }
  }, []);

  // Ctrl+V paste — image=null 시에만 활성 (드롭존 모드)
  useImagePasteTarget({
    enabled: image === null,
    shouldSkip: ({ activeIsInput, event }) => {
      if (activeIsInput) return true;
      if (event.defaultPrevented) return true;
      if (pasteRequireHover && !hovered) return true;
      return false;
    },
    onImage: async (file) => {
      await handleFile(file, onImage, onError);
    },
  });

  // ─── 1. 드롭존 모드 (image === null) ───
  if (!image) {
    return (
      <div
        className="ais-reference-dropzone"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) {
            void handleFile(file, onImage, onError);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => {
          const inp = document.createElement("input");
          inp.type = "file";
          inp.accept = "image/*";
          inp.onchange = () => {
            if (inp.files?.[0]) {
              void handleFile(inp.files[0], onImage, onError);
            }
          };
          inp.click();
        }}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "var(--line)"}`,
          borderRadius: "var(--radius-md)",
          padding: 32,
          textAlign: "center",
          cursor: "pointer",
          color: "var(--ink-2)",
          background: dragOver ? "var(--accent-soft)" : "transparent",
          transition: "all .15s",
        }}
      >
        <Icon name="upload" size={28} />
        <div style={{ marginTop: 12, fontSize: 13 }}>{placeholder}</div>
        <div
          style={{ marginTop: 4, fontSize: 11, color: "var(--ink-3)" }}
        >
          또는 Ctrl+V 로 클립보드 붙여넣기
        </div>
      </div>
    );
  }

  // ─── 2. 라이브러리 픽 모드 (bypassCrop=true) ───
  if (bypassCrop) {
    return (
      <div
        data-testid="reference-image-bypass"
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt="reference (already cropped)"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
        <RemoveButton onClick={() => onImage(null)} />
      </div>
    );
  }

  // ─── 3. crop UI 모드 (사용자 업로드) ───
  return (
    <div
      data-testid="reference-image-crop"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {/* 비율 lock chips (옛 EditReferenceCrop 흡수) */}
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

      {/* Cropper container */}
      <div
        data-testid="crop-area"
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
          image={image}
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
          style={{
            cropAreaStyle: {
              color: "rgba(0, 0, 0, 0.75)",
            },
          }}
        />
        <RemoveButton onClick={() => onImage(null)} />
      </div>

      {/* Zoom slider (옛 EditReferenceCrop 그대로) */}
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

      {/* 도움말 (옛 EditReferenceCrop 그대로) */}
      <div style={{ fontSize: 10.5, color: "var(--ink-4)", lineHeight: 1.5 }}>
        드래그로 영역 이동 · 휠/슬라이더로 확대
        <br />
        <span style={{ color: "var(--warn, #c08400)" }}>
          ⚠ {MIN_CROP_PX}px 미만 영역은 자동 무효 — 원본 이미지가 그대로 전송됩니다
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 공용 sub-components
// ─────────────────────────────────────────────

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label="이미지 제거"
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "rgba(0,0,0,.6)",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        zIndex: 10,
      }}
    >
      <Icon name="x" size={14} />
    </button>
  );
}

// ─────────────────────────────────────────────
// File → dataURL + dimensions 헬퍼
// ─────────────────────────────────────────────

async function handleFile(
  file: File,
  onImage: Props["onImage"],
  onError?: (message: string) => void,
): Promise<void> {
  // 2026-05-16: SourceImageCard/CompareImageSlot 과 업로드 실패 문구 단일화.
  try {
    const { dataUrl, width, height } = await loadImageFile(file);
    const label = `${file.name} · ${width}×${height}`;
    onImage(dataUrl, label, width, height);
  } catch (e) {
    onError?.(formatImageFileError(e));
  }
}
