/**
 * lib/api/types.ts — 도메인 타입 단일 진입점.
 * 2026-04-23 Opus S3: api-client.ts 715줄 분할 — 타입만 이 파일로.
 *
 * 스토어/컴포넌트는 여기에서 import. lib/api-client 는 barrel 재export 만 담당.
 */

export interface HistoryItem {
  id: string;
  mode: "generate" | "edit";
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
