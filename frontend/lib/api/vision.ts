/**
 * lib/api/vision.ts — Vision Analyzer (단일 이미지 → 영/한 상세 설명).
 * 2026-04-24 · C3.
 *
 * Phase 6 (2026-04-27): 동기 JSON 응답 → task-based SSE 로 전환.
 *   - POST → {task_id, stream_url} 받음 → SSE drain → done event payload 추출
 *   - opts.onStage 콜백으로 stage 이벤트 실시간 전달 (PipelineTimeline 연동)
 *   - 옛 호출자 호환 — analyzeImage() 시그니처 유지 (Promise<Result>).
 *
 * Mock 모드: 단계별 sleep + onStage emit + 가짜 결과 반환 (실 백엔드 패턴 모사).
 * Real 모드: POST /api/studio/vision-analyze (multipart) + GET stream/{id} SSE.
 */

import { STUDIO_BASE, USE_MOCK, fetchImageBlob, parseSSE } from "./client";
import type { TaskCreated } from "./generated-helpers";
import { mockAnalyze } from "./mocks/vision";
import type { VisionAnalysisResponse } from "./types";

export interface AnalyzeStageEvent {
  type: string;
  progress: number;
  stageLabel: string;
  /** 백엔드가 보낸 추가 payload (현재는 사용 안 함 · 미래 확장용) */
  extra?: Record<string, unknown>;
}

export interface AnalyzeImageOptions {
  /** 비전 모델 override (기본: 백엔드 DEFAULT_OLLAMA_ROLES.vision) */
  visionModel?: string;
  /** 번역(텍스트) 모델 override (기본: gemma4-un:latest) */
  ollamaModel?: string;
  /** Phase 6 — stage 이벤트 도착 시 호출 (PipelineTimeline 의 stageHistory 갱신) */
  onStage?: (e: AnalyzeStageEvent) => void;
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
      const blob = await fetchImageBlob(src);
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

  // Phase 6: POST 가 task_id + stream_url 반환 (옛처럼 직접 결과 X)
  const createRes = await fetch(`${STUDIO_BASE}/api/studio/vision-analyze`, {
    method: "POST",
    body: form,
  });
  if (!createRes.ok) {
    let detail = "";
    try {
      const j = (await createRes.json()) as { detail?: string };
      detail = j.detail || "";
    } catch {
      /* non-json body */
    }
    throw new Error(
      `vision-analyze ${createRes.status}: ${detail || "요청 실패"}`,
    );
  }
  // Tier 3 (2026-04-27): generated OpenAPI 타입 사용
  const { stream_url } = (await createRes.json()) as TaskCreated;

  // SSE drain — done event payload 추출. stage 이벤트는 onStage 콜백으로 전달.
  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw new Error(`vision-analyze stream ${streamRes.status}`);
  }

  for await (const evt of parseSSE(streamRes)) {
    if (evt.event === "error") {
      const payload = evt.data as { message?: string };
      throw new Error(payload.message || "vision-analyze error");
    }
    if (evt.event === "stage") {
      if (opts.onStage) {
        const payload = evt.data as {
          type: string;
          progress: number;
          stageLabel: string;
        } & Record<string, unknown>;
        const { type, progress, stageLabel, ...extra } = payload;
        opts.onStage({
          type,
          progress,
          stageLabel,
          extra: Object.keys(extra).length > 0 ? extra : undefined,
        });
      }
      continue;
    }
    if (evt.event === "done") {
      // SSE done payload 는 백엔드 done emit shape (옛 JSON 응답 그대로) — 옛 검증 정책 유지.
      return evt.data as unknown as VisionAnalysisResponse;
    }
  }
  throw new Error("vision-analyze: stream closed without done event");
}

