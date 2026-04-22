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
    const res = await fetch(url);
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
    const res = await fetch(url);
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

/** 이미지 URL에서 파일명 추론 (없으면 기본값) */
export function filenameFromRef(
  ref: string,
  fallback = "image.png",
): string {
  if (!ref) return fallback;
  const m = ref.match(/\/([^\/?#]+\.(png|jpg|jpeg|webp))(\?|#|$)/i);
  return m ? m[1] : fallback;
}
