/**
 * image-actions.ts - 이미지 저장/복사 공용 유틸.
 *
 * - downloadImage(url, filename): 서버 이미지 URL → fetch → Blob → <a download>
 * - copyImageToClipboard(url): fetch → Blob → navigator.clipboard.write (PNG)
 * - copyText(text): 단순 텍스트 클립보드
 *
 * data URL 또는 http(s) URL 모두 지원. mock-seed:// 는 무시 (toast 로 알림).
 */

import { toast } from "@/stores/useToastStore";

export async function downloadImage(
  url: string,
  filename = "image.png",
): Promise<boolean> {
  if (!url || url.startsWith("mock-seed://")) {
    toast.warn("실 이미지 없음", "백엔드 연결 상태에서만 저장 가능");
    return false;
  }
  try {
    // cache: "no-store" — 과거에 CORS 헤더 없이 캐시된 응답을 재사용해
    // "blocked by CORS policy" 로 차단되는 현상 방지.
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
    toast.success("저장 완료", filename);
    return true;
  } catch (e) {
    toast.error("저장 실패", e instanceof Error ? e.message : "unknown");
    return false;
  }
}

export async function copyImageToClipboard(url: string): Promise<boolean> {
  if (!url || url.startsWith("mock-seed://")) {
    toast.warn("실 이미지 없음", "Mock 상태 · 복사 불가");
    return false;
  }
  if (!("clipboard" in navigator) || !("write" in navigator.clipboard)) {
    toast.error("클립보드 API 미지원", "현재 브라우저는 이미지 복사 불가");
    return false;
  }
  try {
    // cache: "no-store" — 과거에 CORS 헤더 없이 캐시된 응답을 재사용해
    // "blocked by CORS policy" 로 차단되는 현상 방지.
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const item = new ClipboardItem({ [blob.type || "image/png"]: blob });
    await navigator.clipboard.write([item]);
    toast.success("클립보드에 복사됨");
    return true;
  } catch (e) {
    toast.error("복사 실패", e instanceof Error ? e.message : "unknown");
    return false;
  }
}

export async function copyText(text: string, label = "텍스트"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} 복사됨`);
    return true;
  } catch {
    toast.error("복사 실패");
    return false;
  }
}

/** 이미지·영상 URL에서 파일명 추론 (없으면 기본값).
 *  지원 확장자: 이미지(png/jpg/jpeg/webp/gif) + 영상(mp4/webm/mov). */
export function filenameFromRef(
  ref: string,
  fallback = "image.png",
): string {
  if (!ref) return fallback;
  const m = ref.match(
    /\/([^\/?#]+\.(png|jpg|jpeg|webp|gif|mp4|webm|mov))(\?|#|$)/i,
  );
  return m ? m[1] : fallback;
}

/**
 * 이미지(URL 또는 dataURL)를 썸네일 dataURL 로 리사이즈.
 * localStorage 영속 히스토리용 — 원본 dataURL 을 그대로 저장하면 용량 폭증(수 MB/건).
 * JPEG q80 + longest-side maxDim 으로 보통 30~50KB.
 *
 * 원본보다 작거나 같은 이미지는 그대로 리인코딩 (여전히 JPEG 로 통일해 용량 이득).
 * 실패 시 원본 src 반환 (히스토리는 유지, 용량 제한은 MAX 건수로만 방어).
 */
export async function resizeImageToThumbnail(
  src: string,
  maxDim = 256,
  quality = 0.8,
): Promise<string> {
  if (!src || typeof window === "undefined") return src;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      // dataURL / blob / 동일 origin 은 CORS 무관. 혹시 cross-origin 이면 anonymous.
      if (!src.startsWith("data:") && !src.startsWith("blob:")) {
        el.crossOrigin = "anonymous";
      }
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image load failed"));
      el.src = src;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return src;
    const ratio = Math.min(1, maxDim / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * ratio));
    const th = Math.max(1, Math.round(h * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return src;
    ctx.drawImage(img, 0, 0, tw, th);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    // 리사이즈 실패 — 원본 반환 (용량 부담 감수)
    return src;
  }
}

/**
 * 이미지 URL 을 data URL 로 변환 (CORS 허용 범위 내).
 * edit 모드로 전송 · 템플릿 저장 등 브라우저 로컬 처리를 위해 사용.
 *
 * 반환: {dataUrl, width, height} · 실패 시 null.
 */
export async function urlToDataUrl(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!url || url.startsWith("mock-seed://")) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    // 이미지 크기 측정
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = dataUrl;
    });
    return { dataUrl, width: dims.w, height: dims.h };
  } catch {
    return null;
  }
}
