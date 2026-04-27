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

import { STUDIO_BASE, USE_MOCK, parseSSE, sleep } from "./client";
import type { AnalyzeStageEvent } from "./vision";
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

  // Mock 분기: UI 개발 시 실 백엔드 없이 동작 확인용 (stage emit 도 모사)
  if (USE_MOCK) {
    if (req.onStage) {
      req.onStage({
        type: "compare-encoding",
        progress: 5,
        stageLabel: "이미지 A/B 인코딩",
      });
    }
    await sleep(150);
    if (req.onStage) {
      req.onStage({
        type: "vision-pair",
        progress: 25,
        stageLabel: "두 이미지 비교 분석 (qwen2.5vl)",
      });
    }
    await sleep(500 + Math.random() * 400);
    if (req.onStage) {
      req.onStage({
        type: "translation",
        progress: 75,
        stageLabel: "한국어 번역 (gemma4)",
      });
    }
    await sleep(150);
    if (isCompare) {
      // Vision Compare 5축 mock (composition/color/subject/mood/quality)
      return {
        analysis: {
          scores: {
            composition: 78,
            color: 65,
            subject: 92,
            mood: 70,
            quality: 88,
          },
          overall: 79,
          comments_en: {
            composition: "Similar framing with minor crop differences.",
            color: "Image B has warmer tones.",
            subject: "Same person, slightly different pose.",
            mood: "Both calm but B is brighter.",
            quality: "B has higher resolution feel.",
          },
          comments_ko: {
            composition: "비슷한 프레이밍, 약간의 크롭 차이.",
            color: "B 가 더 따뜻한 톤.",
            subject: "동일 인물, 자세 약간 다름.",
            mood: "둘 다 차분, B 가 더 밝음.",
            quality: "B 가 해상도가 더 좋게 느껴짐.",
          },
          summary_en: "A and B are very similar with mild stylistic shifts.",
          summary_ko: "A·B 매우 유사 · 약간의 스타일 변화.",
          provider: "ollama",
          fallback: false,
          analyzedAt: Date.now(),
          visionModel: req.visionModel ?? "qwen2.5vl:7b",
        },
        saved: false,
      };
    }
    // Edit 5축 mock (face_id/body_pose/attire/background/intent_fidelity) — 기존 그대로
    return {
      analysis: {
        scores: {
          face_id: 92,
          body_pose: 75,
          attire: 60,
          background: 88,
          intent_fidelity: 95,
        },
        overall: 82,
        comments_en: {
          face_id: "Eyes and jaw preserved.",
          body_pose: "Shoulder slightly narrower.",
          attire: "Top color changed as requested.",
          background: "Curtain pattern preserved.",
          intent_fidelity: "Earrings added accurately.",
        },
        comments_ko: {
          face_id: "눈과 턱 보존됨.",
          body_pose: "어깨가 약간 좁아짐.",
          attire: "상의 색상이 요청대로 변경됨.",
          background: "커튼 패턴 보존됨.",
          intent_fidelity: "귀걸이가 정확히 추가됨.",
        },
        summary_en: "Solid result with minor body drift.",
        summary_ko: "신원 보존 양호 · 약간의 체형 변화.",
        provider: "ollama",
        fallback: false,
        analyzedAt: Date.now(),
        visionModel: req.visionModel ?? "qwen2.5vl:7b",
      },
      saved: !!req.historyItemId,
    };
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
  const { stream_url } = (await createRes.json()) as {
    task_id: string;
    stream_url: string;
  };

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
