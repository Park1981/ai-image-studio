/**
 * lib/api/compare.ts — Edit 결과 ↔ 원본 비교 분석 호출.
 * 백엔드 POST /api/studio/compare-analyze 래퍼.
 *
 * Phase 6 (2026-04-27): 동기 JSON → task-based SSE 로 전환.
 * Phase 6 V4 (2026-05-05): compare context 응답 V4 (VisionCompareAnalysisV4 · 2-stage observe + diff_synthesize).
 *   - POST → {task_id, stream_url} 받음 → SSE drain → done event payload 추출
 *   - opts.onStage 콜백으로 stage 이벤트 실시간 전달 (PipelineTimeline 연동)
 *
 * SSE 5 stage 시퀀스 (compare context):
 *   compare-encoding → observe1 → observe2 → diff-synth → translation
 * Edit context 는 옛 시퀀스 유지 (intent-refine + vision-pair + translation).
 *
 * USE_MOCK 모드에선 stage emit + sleep 후 가짜 결과 반환 (실 백엔드 패턴 모사).
 */

import { STUDIO_BASE, USE_MOCK, parseSSE } from "./client";
import type { AnalyzeStageEvent } from "./vision";
import type { TaskCreated } from "./generated-helpers";
import { mockCompareAnalyze } from "./mocks/compare";
import type { ComparisonAnalysis, VisionCompareAnalysisV4 } from "./types";

export interface CompareAnalyzeRequest {
  /** 원본 이미지 / IMAGE_A — File / data URL / 절대 URL */
  source: File | string;
  /** 수정 결과 이미지 / IMAGE_B — File / data URL / 절대 URL */
  result: File | string;
  /** Edit context 일 때 사용자 수정 지시 (compare context 에선 무시). */
  editPrompt: string;
  /** 있으면 백엔드가 DB 에 영구 저장. tsk-{12hex} 형식. */
  historyItemId?: string;
  /** 비전 모델 override (기본 settings.visionModel). */
  visionModel?: string;
  /** 번역 모델 override (기본 settings.ollamaModel). */
  ollamaModel?: string;
  /**
   * 코드 경로 분기 (백엔드 default "edit" · 미전송 시 Edit 경로 = 기존 동작 100%).
   * "compare" → V4 pipeline (compare_pipeline_v4 · 2-stage observe + diff_synthesize)
   */
  context?: "edit" | "compare";
  /** Vision Compare 메뉴 전용 힌트 (context="compare" 일 때만 사용). */
  compareHint?: string;
  /** Phase 6 — stage 이벤트 도착 시 호출 (PipelineTimeline 의 stageHistory 갱신). */
  onStage?: (e: AnalyzeStageEvent) => void;
  /**
   * @deprecated spec §6.2 (2026-05-05) — V4 pipeline 은 promptMode 분기 없음.
   * 필드는 caller 호환을 위해 유지하지만 compareAnalyze 가 더 이상 백엔드로 보내지 않음.
   * 백엔드 v4 receiver 는 키 받아도 무시 (안전망).
   */
  promptMode?: "fast" | "precise";
}

export interface CompareAnalyzeResponse {
  /**
   * 분석 결과. context="edit" → ComparisonAnalysis (Edit v3 도메인 슬롯),
   * context="compare" → VisionCompareAnalysisV4 (V4 · 2-stage observe + diff_synthesize).
   * 호출자가 context 를 알고 있으므로 적절히 narrow 가능.
   */
  analysis: ComparisonAnalysis | VisionCompareAnalysisV4;
  /** historyItemId 가 DB 에 존재하고 갱신 성공 시 true. */
  saved: boolean;
}

function getStudioImageRef(input: File | string): string | null {
  if (input instanceof File) return null;
  if (input.startsWith("/images/")) return input;

  try {
    const url = new URL(input);
    const studioBase = new URL(STUDIO_BASE);
    if (url.origin === studioBase.origin && url.pathname.startsWith("/images/")) {
      return url.pathname;
    }
  } catch {
    return null;
  }

  return null;
}

/** File / data URL / 절대 URL → Blob 변환 (Edit 의 패턴 동일). */
async function toBlob(input: File | string): Promise<Blob> {
  // File 객체는 그대로 반환
  if (input instanceof File) return input;
  // 문자열(data URL / 절대 URL) 은 fetch 후 Blob 변환
  const res = await fetch(input);
  if (!res.ok) {
    throw new Error(`image fetch ${res.status}: ${input.slice(0, 80)}`);
  }
  return res.blob();
}

/**
 * 원본 · 수정 결과 이미지 쌍을 백엔드에 보내 비교 분석 결과를 가져온다.
 *
 * - Mock 모드: 800~1400ms sleep 후 가짜 ComparisonAnalysis 반환.
 * - Real 모드: multipart/form-data POST → shape 검증 → 반환.
 * - 응답 shape 검증: analysis 필드 존재 + 객체 타입 확인. 실패 시 Error throw.
 */
export async function compareAnalyze(
  req: CompareAnalyzeRequest,
): Promise<CompareAnalyzeResponse> {
  const isCompare = req.context === "compare";

  // Mock 분기 — UI 개발 시 실 백엔드 없이 동작 확인용 (stage emit 모사)
  if (USE_MOCK) {
    return mockCompareAnalyze(req);
  }

  // Real 분기: multipart/form-data 빌드
  const form = new FormData();
  const sourceRef = getStudioImageRef(req.source);
  const resultRef = getStudioImageRef(req.result);
  if (sourceRef) {
    form.append("source_ref", sourceRef);
  } else {
    const sourceBlob = await toBlob(req.source);
    form.append("source", sourceBlob, "source.png");
  }
  if (resultRef) {
    form.append("result_ref", resultRef);
  } else {
    const resultBlob = await toBlob(req.result);
    form.append("result", resultBlob, "result.png");
  }
  // meta 빌드 — context 없으면 백엔드 기본 "edit" 으로 동작 (기존 호출자 100% 무영향)
  const metaPayload: Record<string, unknown> = {
    editPrompt: req.editPrompt,
    historyItemId: req.historyItemId,
    visionModel: req.visionModel,
    ollamaModel: req.ollamaModel,
    sourceRef,
    resultRef,
  };
  if (isCompare) {
    metaPayload.context = "compare";
    metaPayload.compareHint = req.compareHint ?? "";
  }
  // spec §6.2 (2026-05-05): promptMode 더 이상 백엔드로 보내지 않음.
  // V4 pipeline 이 무관하고, Edit context 도 통일. caller 가 promptMode 넣어도 무시.
  form.append("meta", JSON.stringify(metaPayload));

  // Phase 6: POST 가 task_id + stream_url 반환 (옛처럼 직접 결과 X)
  const createRes = await fetch(`${STUDIO_BASE}/api/studio/compare-analyze`, {
    method: "POST",
    body: form,
  });
  if (!createRes.ok) {
    throw new Error(`compare-analyze failed: ${createRes.status}`);
  }
  // Tier 3 (2026-04-27): generated OpenAPI 타입 사용
  const { stream_url } = (await createRes.json()) as TaskCreated;

  // SSE drain — done event payload 추출. stage 이벤트는 onStage 콜백.
  const streamRes = await fetch(`${STUDIO_BASE}${stream_url}`, {
    headers: { accept: "text/event-stream" },
  });
  if (!streamRes.ok) {
    throw new Error(`compare-analyze stream ${streamRes.status}`);
  }

  for await (const evt of parseSSE(streamRes)) {
    if (evt.event === "error") {
      const payload = evt.data as { message?: string };
      throw new Error(payload.message || "compare-analyze error");
    }
    if (evt.event === "stage") {
      if (req.onStage) {
        const payload = evt.data as {
          type: string;
          progress: number;
          stageLabel: string;
        } & Record<string, unknown>;
        const { type, progress, stageLabel, ...extra } = payload;
        req.onStage({
          type,
          progress,
          stageLabel,
          extra: Object.keys(extra).length > 0 ? extra : undefined,
        });
      }
      continue;
    }
    if (evt.event === "done") {
      const json = evt.data as Partial<CompareAnalyzeResponse>;
      if (!json.analysis || typeof json.analysis !== "object") {
        throw new Error("compare-analyze: malformed done payload");
      }
      return {
        analysis: json.analysis,
        saved: !!json.saved,
      };
    }
  }
  throw new Error("compare-analyze: stream closed without done event");
}

/* ──────────────────────────────────────────────────────────────────────
 * V4 on-demand t2i prompt 합성 (Task 30 · 2026-05-05).
 * 메인 분석 결과의 observation1/2 중 하나로부터 prompt_synthesize 5 슬롯 합성.
 * 단일 JSON 응답 (non-SSE) — 약 10~20초 + GPU lock (busy 시 503).
 * ──────────────────────────────────────────────────────────────────── */

export interface PerImagePromptResponse {
  summary: string;
  positive_prompt: string;
  negative_prompt: string;
  key_visual_anchors: string[];
  uncertain: string[];
}

export async function compareAnalyzePerImagePrompt(
  observation: Record<string, unknown>,
  ollamaModel?: string,
): Promise<PerImagePromptResponse> {
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/compare-analyze/per-image-prompt`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ observation, ollamaModel }),
    },
  );
  if (res.status === 503) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: { code?: string; message?: string };
    };
    throw new Error(
      body.detail?.message || "GPU busy — 잠시 후 다시 시도해주세요",
    );
  }
  if (!res.ok) {
    throw new Error(`per-image-prompt failed: ${res.status}`);
  }
  return res.json();
}
