/**
 * lib/api/prompt-tools — Phase 5 (2026-05-01) 신설.
 *
 * 백엔드 신규 엔드포인트 클라이언트:
 *  - POST /api/studio/prompt/split — 긴 프롬프트 → 카드 배열
 *  - POST /api/studio/prompt/translate — 한↔영 양방향 번역
 *
 * Mock: USE_MOCK 모드에서도 동작하도록 간단한 분기 유지 (백엔드 없이 UI 개발 시).
 */

import { sleep, STUDIO_BASE, USE_MOCK } from "./client";

/** spec §4.5 의 17 카테고리 (소문자 영문). 백엔드의 ALLOWED_SECTION_KEYS 와 1:1 동기화. */
export const PROMPT_SECTION_KEYS = [
  "subject",
  "composition",
  "face",
  "eyes",
  "nose",
  "lips",
  "skin",
  "makeup",
  "expression",
  "hair",
  "outfit",
  "background",
  "lighting",
  "style",
  "quality",
  "negative",
  "etc",
] as const;

export type PromptSectionKey = (typeof PROMPT_SECTION_KEYS)[number];

export interface PromptSection {
  key: PromptSectionKey;
  text: string;
}

export interface PromptSplitResponse {
  sections: PromptSection[];
  /** 'ollama' | 'fallback' | 'fallback-precise-failed' */
  provider: string;
  fallback: boolean;
  /** fallback 사유 (있으면 짧은 한 줄 — 토스트로 그대로 사용 가능). */
  error?: string | null;
  /** 디버그용 모델 원시 응답 (UI 노출 X). */
  raw?: string;
}

export type TranslateDirection = "ko" | "en";

export interface PromptTranslateResponse {
  translated: string;
  provider: string;
  fallback: boolean;
  direction: TranslateDirection;
  error?: string | null;
}

/**
 * 긴 프롬프트를 의미 카드로 분리.
 *
 * 실패 / 빈 입력 / JSON 파싱 실패 시 sections=[] + fallback=true. UI 는 토스트만
 * 띄우고 사용자 textarea 는 절대 자동 변경하지 않는다 (spec §11 비목표).
 */
export async function splitPrompt(params: {
  prompt: string;
  ollamaModel?: string;
}): Promise<PromptSplitResponse> {
  if (USE_MOCK) {
    await sleep(700 + Math.random() * 500);
    return {
      sections: [
        { key: "subject", text: "20yo Korean woman, K-pop idol look (mock)" },
        { key: "face", text: "symmetrical face, sharp jawline" },
        { key: "outfit", text: "red satin dress, gold accessories" },
        { key: "lighting", text: "cinematic teal-orange grading" },
      ],
      provider: "mock",
      fallback: false,
    };
  }
  const res = await fetch(`${STUDIO_BASE}/api/studio/prompt/split`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`prompt/split failed: ${res.status}`);
  return (await res.json()) as PromptSplitResponse;
}

/**
 * 프롬프트 한↔영 양방향 번역.
 *
 * direction:
 *  - "ko" — 영문 → 한국어
 *  - "en" — 한국어 → 영문 (Stable Diffusion / Qwen 호환)
 *
 * 실패 시 translated=원문 + fallback=true (UI 가 그대로 표시).
 */
export async function translatePrompt(params: {
  prompt: string;
  direction: TranslateDirection;
  ollamaModel?: string;
}): Promise<PromptTranslateResponse> {
  if (USE_MOCK) {
    await sleep(500 + Math.random() * 400);
    const translated =
      params.direction === "ko"
        ? `[mock 번역] ${params.prompt}`
        : `[mock translation] ${params.prompt}`;
    return {
      translated,
      provider: "mock",
      fallback: false,
      direction: params.direction,
    };
  }
  const res = await fetch(`${STUDIO_BASE}/api/studio/prompt/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`prompt/translate failed: ${res.status}`);
  return (await res.json()) as PromptTranslateResponse;
}
