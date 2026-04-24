/**
 * lib/api/vision.ts — Vision Analyzer (단일 이미지 → 영/한 상세 설명).
 * 2026-04-24 · C3.
 *
 * Mock 모드에선 800ms 지연 + 가짜 영/한 텍스트 반환.
 * Real 모드에선 POST /api/studio/vision-analyze (multipart) 호출.
 */

import { STUDIO_BASE, USE_MOCK, sleep } from "./client";
import type { VisionAnalysisResponse } from "./types";

export interface AnalyzeImageOptions {
  /** 비전 모델 override (기본: 백엔드 DEFAULT_OLLAMA_ROLES.vision) */
  visionModel?: string;
  /** 번역(텍스트) 모델 override (기본: gemma4-un:latest) */
  ollamaModel?: string;
}

/**
 * 단일 이미지 분석.
 *
 * sourceImage 허용 포맷:
 *   - "data:image/..."  — FileReader 업로드 직후
 *   - "http://..." or "/images/..." — 히스토리·서버 이미지 URL (fetch→blob)
 *   - File 객체 — SourceImageCard 등에서 직접 전달 (현재 경로 없지만 확장성)
 *
 * 에러:
 *   - 이미지 fetch 실패 · 413 · 400 등은 Error throw (호출처에서 토스트)
 *   - 200 응답이지만 fallback=true 면 정상 return (호출처가 필드로 판단)
 */
export async function analyzeImage(
  sourceImage: string | File,
  opts: AnalyzeImageOptions = {},
): Promise<VisionAnalysisResponse> {
  if (USE_MOCK) {
    return mockAnalyze(sourceImage, opts);
  }

  const form = new FormData();
  if (typeof sourceImage === "string") {
    const src = sourceImage;
    if (src.startsWith("mock-seed://")) {
      throw new Error(
        "Mock 결과 이미지는 분석에 사용 불가. 실제 이미지를 올려줘.",
      );
    }
    try {
      const res = await fetch(src);
      if (!res.ok) {
        throw new Error(`image fetch ${res.status}`);
      }
      const blob = await res.blob();
      const guessedName = src.startsWith("data:")
        ? "upload.png"
        : src.split("/").pop()?.split("?")[0] || "source.png";
      form.append("image", blob, guessedName);
    } catch (err) {
      throw new Error(
        `이미지 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    form.append("image", sourceImage);
  }
  form.append(
    "meta",
    JSON.stringify({
      visionModel: opts.visionModel,
      ollamaModel: opts.ollamaModel,
    }),
  );

  const res = await fetch(`${STUDIO_BASE}/api/studio/vision-analyze`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    // 413 (too large) / 400 (bad meta or empty) 등 — 프론트 토스트용 메시지
    let detail = "";
    try {
      const j = (await res.json()) as { detail?: string };
      detail = j.detail || "";
    } catch {
      /* non-json body */
    }
    throw new Error(`vision-analyze ${res.status}: ${detail || "요청 실패"}`);
  }
  return (await res.json()) as VisionAnalysisResponse;
}

/* ───────── Mock ───────── */

async function mockAnalyze(
  _sourceImage: string | File,
  _opts: AnalyzeImageOptions,
): Promise<VisionAnalysisResponse> {
  // 인자 사용 안 함 — Mock 은 고정 응답. underscore prefix 만으로는 lint 통과 안 돼서 명시적 noop.
  void _sourceImage;
  void _opts;
  await sleep(600 + Math.random() * 400);
  return {
    en: "Editorial-style portrait photograph, soft north-facing window light pooling on the subject's left cheek, shallow depth of field with creamy bokeh, neutral warm palette blending ochre and muted terracotta, fine skin texture retained with subtle 35mm film grain, balanced rule-of-thirds composition, slight matte film look, quiet contemplative mood.",
    ko: "에디토리얼 스타일 인물 사진, 북쪽 창가에서 들어오는 부드러운 빛이 피사체의 왼쪽 볼에 고임, 크리미한 보케가 만드는 얕은 심도, 오커와 뮤트 테라코타가 섞인 뉴트럴 웜 팔레트, 35mm 필름의 미묘한 그레인이 살아있는 섬세한 피부 질감, 삼분할 구도의 균형 있는 프레이밍, 매트한 필름 룩, 차분하고 사색적인 분위기.",
    provider: "mock",
    fallback: false,
    width: 1024,
    height: 1024,
    sizeBytes: 482_000,
  };
}
