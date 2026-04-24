/**
 * lib/api/types.ts — 도메인 타입 단일 진입점.
 * 2026-04-23 Opus S3: api-client.ts 715줄 분할 — 타입만 이 파일로.
 *
 * 스토어/컴포넌트는 여기에서 import. lib/api-client 는 barrel 재export 만 담당.
 */

/* ──────────── Comparison Analysis (Edit 결과 vs 원본) ──────────── */

/** 비교 분석 5축 점수 (0-100 정수). 누락 축은 null 가능 — UI 에서 dash 표시. */
export interface ComparisonScores {
  face_id: number | null;
  body_pose: number | null;
  attire: number | null;
  background: number | null;
  intent_fidelity: number | null;
}

/** 5축 각각의 1-2 문장 코멘트 (en 또는 ko). */
export type ComparisonComments = {
  [K in keyof ComparisonScores]: string;
};

/** 비교 분석 단일 결과 — history item 에 영구 저장. */
export interface ComparisonAnalysis {
  scores: ComparisonScores;
  /** 5축 산술 평균 (0-100). null 점수는 평균 계산에서 제외. */
  overall: number;
  comments_en: ComparisonComments;
  comments_ko: ComparisonComments;
  summary_en: string;
  summary_ko: string;
  provider: "ollama" | "fallback";
  fallback: boolean;
  /** 분석 시점 unix ms. */
  analyzedAt: number;
  visionModel: string;
}

export interface HistoryItem {
  id: string;
  mode: "generate" | "edit" | "video";
  prompt: string;
  label: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  lightning: boolean;
  model: string;
  createdAt: number;
  /** generate/edit 은 이미지 URL, video 는 mp4 URL */
  imageRef: string;
  /** 실 백엔드가 보조로 포함할 수 있는 메타 */
  upgradedPrompt?: string;
  /** 업그레이드된 영문 프롬프트의 한국어 번역 (v2 · 2026-04-23) */
  upgradedPromptKo?: string | null;
  promptProvider?: string;
  researchHints?: string[];
  visionDescription?: string;
  /** ComfyUI 에러 메시지 (Mock 폴백 시) */
  comfyError?: string | null;

  /* ── Video 전용 메타 (mode === "video" 일 때만 채워짐) ── */
  /** 영상 길이 (초) */
  durationSec?: number;
  /** 프레임률 */
  fps?: number;
  /** 총 프레임 수 */
  frameCount?: number;

  /* ── Edit 모드 비교 분석 (mode === "edit" 일 때만 채워짐) ── */
  /** 원본 이미지 영구 경로 (예: "/images/studio/edit-source/{id}.png").
   *  옛 row 또는 generate/video 결과는 undefined. */
  sourceRef?: string;
  /** 비교 분석 결과. 분석 안 한 경우 undefined. */
  comparisonAnalysis?: ComparisonAnalysis;
}

export interface GenerateRequest {
  prompt: string;
  aspect: string;
  /** 사용자가 픽셀 직접 지정 — 주어지면 백엔드가 aspect 프리셋 대신 사용 */
  width?: number;
  height?: number;
  steps: number;
  cfg: number;
  seed: number;
  lightning: boolean;
  research: boolean;
  /** 설정 override (없으면 백엔드 기본값) */
  ollamaModel?: string;
  visionModel?: string;
  /** showUpgradeStep 사용 시: 모달에서 사용자가 확정한 영문 프롬프트 */
  preUpgradedPrompt?: string;
  /** upgrade-only 단계에서 이미 얻은 Claude 힌트 — 빈 배열 [] 도 "조사 완료" 로 간주됨.
   *  undefined 이면 백엔드가 research 플래그대로 조사 실행. */
  preResearchHints?: string[];
}

export interface UpgradeOnlyResult {
  upgradedPrompt: string;
  /** 한국어 번역 (v2 · 2026-04-23). null 이면 파싱 실패 or fallback */
  upgradedPromptKo?: string | null;
  provider: string;
  fallback: boolean;
  researchHints: string[];
}

export interface EditRequest {
  /** data URL, 서버 ref, 또는 File 객체 */
  sourceImage: string | File;
  prompt: string;
  lightning: boolean;
  ollamaModel?: string;
  visionModel?: string;
}

export type GenStage =
  | {
      type:
        | "prompt-parse"
        | "gemma4-upgrade"
        | "claude-research"
        | "workflow-dispatch"
        | "comfyui-sampling"
        | "postprocess";
      progress: number;
      stageLabel: string;
      /** comfyui-sampling 시 현재 샘플러 step (예: 3) */
      samplingStep?: number | null;
      /** comfyui-sampling 시 총 샘플러 step (예: 40) */
      samplingTotal?: number | null;
    }
  | { type: "done"; item: HistoryItem; savedToHistory: boolean };

export type EditStage =
  | {
      type: "step";
      step: 1 | 2 | 3 | 4;
      done: boolean;
      /** step 1 done 에서 도착하는 비전 설명 */
      description?: string;
      /** step 2 done 에서 도착하는 최종 프롬프트 (영문) */
      finalPrompt?: string;
      /** step 2 done 에서 도착하는 한국어 번역 (v2 · 2026-04-23) */
      finalPromptKo?: string | null;
      /** step 2 provider (ollama/fallback) */
      provider?: string;
    }
  | {
      /** ComfyUI 샘플링 중 진행률/스텝 업데이트 (step 4 내부) */
      type: "sampling";
      progress: number;
      samplingStep?: number | null;
      samplingTotal?: number | null;
    }
  /**
   * 백엔드가 emit 하는 전체 파이프라인 진행률 (0~100) + 단계 라벨.
   * Generate 의 GenStage 와 동일한 의미로 통일 — ProgressModal 의 상단 진행바는 이 값만 사용.
   */
  | {
      type: "stage";
      stageType: string;
      progress: number;
      stageLabel: string;
      samplingStep?: number;
      samplingTotal?: number;
    }
  | { type: "done"; item: HistoryItem; savedToHistory: boolean };

export interface OllamaModel {
  name: string;
  size_gb: number;
  modified_at: string;
}

export interface VramSnapshot {
  usedGb: number;
  totalGb: number;
}

/**
 * 백엔드 /process/status 폴링 결과 — Ollama/ComfyUI 실행 상태 + VRAM 사용량.
 * Mock 모드에선 현재 상태 유지 가정 (서버 쿼리 없음).
 */
export interface ProcessStatusSnapshot {
  ollamaRunning: boolean;
  comfyuiRunning: boolean;
  /** nvidia-smi 실패 시 null. total_gb=0 이거나 쿼리 실패면 null 반환. */
  vram: VramSnapshot | null;
}

/**
 * POST /api/studio/vision-analyze 응답 — Vision Analyzer 독립 페이지용.
 * 백엔드는 비전 호출 실패여도 HTTP 200 + fallback=true 로 반환하니 상태 분기는 fallback 필드로.
 */
/* ──────────── Video i2v (LTX-2.3) ──────────── */

export interface VideoRequest {
  /** data URL, 서버 ref, 또는 File 객체 */
  sourceImage: string | File;
  prompt: string;
  ollamaModel?: string;
  visionModel?: string;
  /**
   * 성인 모드 토글 (2026-04-24 · v8).
   * true 면 gemma4 시스템 프롬프트에 NSFW clause 주입 + eros LoRA 체인 포함.
   * false 면 distilled LoRA 만 로드 (SFW, 얼굴 보존 안정).
   */
  adult?: boolean;
  /**
   * 영상 해상도 · 긴 변 픽셀 (2026-04-24 · v9).
   * 512~1536 (step 128). 원본 비율 유지하며 긴 변만 이 값으로 스케일.
   * 작을수록 빠름 (시간 ~ 픽셀수 제곱에 비례).
   * 누락 시 백엔드 기본값 (1536) 사용.
   */
  longerEdge?: number;
  /**
   * Lightning 4-step 초고속 모드 (2026-04-24 · v10).
   * true  (기본) — distilled LoRA + 4-step sigmas (5분 내외, 얼굴 drift 가능)
   * false        — LoRA 체인 스킵 + 30-step full sigmas (20분+, 얼굴 보존 최강)
   */
  lightning?: boolean;
}

export type VideoStage =
  | {
      type: "step";
      step: 1 | 2 | 3 | 4 | 5;
      done: boolean;
      /** step 1 done 의 비전 설명 */
      description?: string;
      /** step 2 done 의 최종 LTX 프롬프트 (영문) */
      finalPrompt?: string;
      /** step 2 done 의 한글 번역 */
      finalPromptKo?: string | null;
      /** step 2 provider (ollama/fallback) */
      provider?: string;
    }
  | {
      /** ComfyUI 샘플링 상세 (step 4 내부) */
      type: "sampling";
      progress: number;
      samplingStep?: number | null;
      samplingTotal?: number | null;
    }
  | {
      /** 백엔드 파이프라인 진행률 (0~100) + 단계 라벨 */
      type: "stage";
      stageType: string;
      progress: number;
      stageLabel: string;
      samplingStep?: number;
      samplingTotal?: number;
    }
  | { type: "done"; item: HistoryItem; savedToHistory: boolean };

/* ──────────── Vision Analyzer ──────────── */

export interface VisionAnalysisResponse {
  /** 영문 상세 설명 (40-120 단어 목표). fallback=true 면 빈 문자열. */
  en: string;
  /** 한글 번역. 번역만 실패해도 en 은 보존되고 ko=null. */
  ko: string | null;
  /** 백엔드: "ollama" | "fallback". Mock 경로: "mock". */
  provider: "ollama" | "fallback" | "mock";
  fallback: boolean;
  /** PIL 측정값. 추출 실패 시 0. */
  width: number;
  height: number;
  sizeBytes: number;
}
