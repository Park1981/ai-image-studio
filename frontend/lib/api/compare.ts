/**
 * lib/api/compare.ts — Edit 결과 ↔ 원본 비교 분석 호출.
 * 백엔드 POST /api/studio/compare-analyze 래퍼.
 *
 * Phase 6 (2026-04-27): 동기 JSON → task-based SSE 로 전환.
 *   - POST → {task_id, stream_url} 받음 → SSE drain → done event payload 추출
 *   - opts.onStage 콜백으로 stage 이벤트 실시간 전달 (PipelineTimeline 연동)
 *   - 옛 호출자 호환 — compareAnalyze() 시그니처 + 반환 타입 유지.
 *
 * USE_MOCK 모드에선 stage emit + sleep 후 가짜 결과 반환 (실 백엔드 패턴 모사).
 */

import { STUDIO_BASE, USE_MOCK, parseSSE } from "./client";
import type { AnalyzeStageEvent } from "./vision";
import type { TaskCreated } from "./generated-helpers";
import { mockCompareAnalyze } from "./mocks/compare";
import type { ComparisonAnalysis, VisionCompareAnalysis } from "./types";

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
   * "compare" → analyze_pair_generic 호출 + 5축 (composition/color/subject/mood/quality)
   */
  context?: "edit" | "compare";
  /** Vision Compare 메뉴 전용 힌트 (context="compare" 일 때만 사용). */
  compareHint?: string;
  /** Phase 6 — stage 이벤트 도착 시 호출 (PipelineTimeline 의 stageHistory 갱신). */
  onStage?: (e: AnalyzeStageEvent) => void;
}

export interface CompareAnalyzeResponse {
  /**
   * 분석 결과. context="edit" → ComparisonAnalysis (Edit 5축),
   * context="compare" → VisionCompareAnalysis (Vision Compare 5축).
   * 호출자가 context 를 알고 있으므로 적절히 narrow 가능.
   */
  analysis: ComparisonAnalysis | VisionCompareAnalysis;
  /** historyItemId 가 DB 에 존재하고 갱신 성공 시 true. */
  saved: boolean;
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
  const sourceBlob = await toBlob(req.source);
  const resultBlob = await toBlob(req.result);
  form.append("source", sourceBlob, "source.png");
  form.append("result", resultBlob, "result.png");
  // meta 빌드 — context 없으면 백엔드 기본 "edit" 으로 동작 (기존 호출자 100% 무영향)
  const metaPayload: Record<string, unknown> = {
    editPrompt: req.editPrompt,
    historyItemId: req.historyItemId,
    visionModel: req.visionModel,
    ollamaModel: req.ollamaModel,
  };
  if (isCompare) {
    metaPayload.context = "compare";
    metaPayload.compareHint = req.compareHint ?? "";
  }
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
