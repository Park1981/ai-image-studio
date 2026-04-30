/**
 * image-crop — Edit multi-ref 의 클라이언트 측 이미지 crop 헬퍼.
 *
 * 2026-04-28 (수동 crop UI · Phase 2).
 *
 * 흐름 (plan §6 Phase 2 §변환 흐름):
 *   data URL (store.referenceImage)
 *     ↓ dataUrlToBlob
 *   Blob
 *     ↓ cropBlobByArea(area = croppedAreaPixels)
 *   cropped Blob
 *     ↓ new File([..], 'reference-crop.png', ..)
 *   File → FormData 의 reference_image 필드 → 백엔드 multipart
 *
 * canvas/Image API 의존이라 SSR X · "use client" 컨텍스트에서만 호출 가능.
 */

import type { CropArea } from "@/stores/useEditStore";

/**
 * data URL (또는 ObjectURL · http URL) 을 Blob 으로 변환.
 * 내부적으로 fetch 를 사용 — 브라우저 standard 패턴.
 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  if (!res.ok) {
    throw new Error(
      `dataUrlToBlob: fetch ${res.status} (${dataUrl.slice(0, 60)}…)`,
    );
  }
  return await res.blob();
}

/**
 * Blob (이미지) 을 area (원본 픽셀 좌표) 로 crop → 새 PNG Blob.
 *
 * 좌표계: react-easy-crop 의 croppedAreaPixels 와 동일 — 원본 이미지의
 * 픽셀 좌표 (zoom/pan 무관). canvas drawImage 의 source rect 에 그대로 사용.
 *
 * 결과 Blob 은 항상 PNG (alpha 보존 + 무손실).
 */
export async function cropBlobByArea(
  blob: Blob,
  area: CropArea,
): Promise<Blob> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(objectUrl);

    const w = Math.max(1, Math.round(area.width));
    const h = Math.max(1, Math.round(area.height));
    const sx = Math.max(0, Math.round(area.x));
    const sy = Math.max(0, Math.round(area.y));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("cropBlobByArea: canvas 2d context 사용 불가");
    }
    // source rect (sx,sy,w,h) → dest rect (0,0,w,h) — 1:1 픽셀 복사
    ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);

    return await canvasToPngBlob(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * crop area 가 null 이면 원본 그대로 반환, 있으면 cropBlobByArea 호출.
 * useEditPipeline 의 분기 단순화용 + 단위 테스트 용이성 확보.
 */
export async function cropBlobIfArea(
  blob: Blob,
  area: CropArea | null,
): Promise<Blob> {
  if (!area) return blob;
  return cropBlobByArea(blob, area);
}

/* ──────────── 라이브러리 썸네일 압축 (2026-04-30 후속) ──────────── */

/**
 * Blob → WebP dataURL 변환 + maxSize 안에 fit 리사이즈.
 *
 * 라이브러리 썸네일용 — localStorage quota 절약 목적.
 * PNG dataURL (수 MB) → WebP 256px (~20-30KB) ≈ 95%+ 절감.
 *
 * @param blob 원본 이미지 Blob (PNG/JPEG/WebP/...)
 * @param maxSize 긴 변 최대 픽셀 (기본 256 — SnippetCard grid 160px minmax 충분)
 * @param quality WebP quality 0..1 (기본 0.75 — 시각 차이 거의 없음)
 * @returns WebP dataURL ("data:image/webp;base64,...")
 */
export async function blobToCompressedThumbDataUrl(
  blob: Blob,
  maxSize: number = 256,
  quality: number = 0.75,
): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(objectUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w <= 0 || h <= 0) throw new Error("blobToCompressedThumbDataUrl: 이미지 크기 0");

    // 긴 변 기준 maxSize 안에 fit (이미 작으면 1.0 = 그대로)
    const ratio = Math.min(1, maxSize / Math.max(w, h));
    const targetW = Math.max(1, Math.round(w * ratio));
    const targetH = Math.max(1, Math.round(h * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("blobToCompressedThumbDataUrl: canvas 2d context 사용 불가");
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const url = canvas.toDataURL("image/webp", quality);
    if (!url || !url.startsWith("data:image/webp")) {
      throw new Error("WebP 인코딩 실패 (브라우저 미지원?)");
    }
    return url;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * 기존 dataURL (PNG/JPEG/...) → WebP 압축. 이미 WebP 면 그대로 반환 (idempotent).
 * usePromptSnippetsStore 의 마이그레이션 흐름에서 사용.
 */
export async function compressDataUrlToWebp(
  dataUrl: string,
  maxSize: number = 256,
  quality: number = 0.75,
): Promise<string> {
  if (dataUrl.startsWith("data:image/webp")) {
    return dataUrl; // idempotent — 이미 변환됨
  }
  const blob = await dataUrlToBlob(dataUrl);
  return await blobToCompressedThumbDataUrl(blob, maxSize, quality);
}

/* ──────────── 내부 헬퍼 ──────────── */

/** Image 를 src URL 에서 비동기 로드 — onload 까지 기다림. */
function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`이미지 로드 실패: ${src.slice(0, 60)}…`));
    img.src = src;
  });
}

/** canvas → PNG Blob 변환 (toBlob Promise 래핑). */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("canvas.toBlob: null 반환"));
    }, "image/png");
  });
}
