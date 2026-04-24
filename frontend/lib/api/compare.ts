/**
 * lib/api/compare.ts — Edit 결과 ↔ 원본 비교 분석 호출.
 * 백엔드 POST /api/studio/compare-analyze 래퍼.
 *
 * USE_MOCK 모드에선 sleep 후 가짜 ComparisonAnalysis 반환 (UI 개발용).
 */

import { STUDIO_BASE, USE_MOCK, sleep } from "./client";
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

  // Mock 분기: UI 개발 시 실 백엔드 없이 동작 확인용
  if (USE_MOCK) {
    await sleep(800 + Math.random() * 600);
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

  // 백엔드 호출
  const res = await fetch(`${STUDIO_BASE}/api/studio/compare-analyze`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`compare-analyze failed: ${res.status}`);
  }

  // 응답 shape 최소 검증 — 백엔드 신뢰 X (codex 1차 리뷰 교훈)
  const json = (await res.json()) as Partial<CompareAnalyzeResponse>;
  if (!json.analysis || typeof json.analysis !== "object") {
    throw new Error("compare-analyze: malformed response");
  }
  return {
    analysis: json.analysis,
    saved: !!json.saved,
  };
}
