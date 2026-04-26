/**
 * lib/api/types.ts — 도메인 타입 단일 진입점.
 * 2026-04-23 Opus S3: api-client.ts 715줄 분할 — 타입만 이 파일로.
 *
 * 스토어/컴포넌트는 여기에서 import. lib/api-client 는 barrel 재export 만 담당.
 */

/* ──────────── Comparison Analysis (Edit 결과 vs 원본) ──────────── */

/** v1 (옛 형식 · 호환만 유지) — 5축 유사도 점수 */
export interface ComparisonScoresLegacy {
  face_id: number | null;
  body_pose: number | null;
  attire: number | null;
  background: number | null;
  intent_fidelity: number | null;
}

/** v1 5축 코멘트 (옛 형식) */
export type ComparisonCommentsLegacy = {
  [K in keyof ComparisonScoresLegacy]: string;
};

/** v3 슬롯 엔트리 (spec 16) — intent + score + comment(en/ko) */
export interface ComparisonSlotEntry {
  intent: "edit" | "preserve";
  /** 0-100. 보존 의도면 유사도, 변경 의도면 의도부합도. fallback 시 null. */
  score: number | null;
  commentEn: string;
  commentKo: string;
}

/**
 * 비교 분석 단일 결과 — history item 에 영구 저장.
 * v1 (옛) 와 v3 (신규) 모두 호환 — 프론트가 키 셋으로 자동 분기:
 *   - slots 있음 → v3 (domain + 5 슬롯 매트릭스 + 의도 컨텍스트 점수)
 *   - slots 없고 scores 있음 → v1 (옛 5축 유사도)
 */
export interface ComparisonAnalysis {
  /** v3 (analyze_pair) — domain + slots */
  domain?: "person" | "object_scene";
  slots?: Record<string, ComparisonSlotEntry>;

  /** v1 (옛 row 호환) — scores + comments */
  scores?: ComparisonScoresLegacy;
  comments_en?: ComparisonCommentsLegacy;
  comments_ko?: ComparisonCommentsLegacy;

  /** 산술평균 종합 점수 (양 형식 공통) */
  overall: number;
  summary_en: string;
  summary_ko: string;

  /** spec 19 (2026-04-26 · Codex 진단 #3 반영) — 옵셔널.
   * Edit context 의도 부합도 잔여 작업 + 비교 못한 영역 명시.
   * 옛 row 는 없음 → undefined. UI 는 값 있을 때만 표시. */
  transform_prompt_en?: string;
  transform_prompt_ko?: string;
  uncertain_en?: string;
  uncertain_ko?: string;

  provider: "ollama" | "fallback";
  fallback: boolean;
  analyzedAt: number;
  visionModel: string;
}

/** v3 도메인별 슬롯 키 순서 + 한글 라벨 (사전 분석과 동일) */
export const COMPARISON_PERSON_SLOTS: readonly string[] = [
  "face_expression",
  "hair",
  "attire",
  "body_pose",
  "background",
] as const;

export const COMPARISON_OBJECT_SCENE_SLOTS: readonly string[] = [
  "subject",
  "color_material",
  "layout_composition",
  "background_setting",
  "mood_style",
] as const;

/** v1 옛 5축 키 순서 + 한글 라벨 (호환만) */
export const COMPARISON_LEGACY_AXES: readonly (keyof ComparisonScoresLegacy)[] = [
  "face_id",
  "body_pose",
  "attire",
  "background",
  "intent_fidelity",
] as const;

export const COMPARISON_LEGACY_LABELS_KO: Record<
  keyof ComparisonScoresLegacy,
  string
> = {
  face_id: "얼굴 ID",
  body_pose: "체형/포즈",
  attire: "의상/누드 상태",
  background: "배경 보존",
  intent_fidelity: "의도 충실도",
};

/* ──────────── Edit 이미지 구조 분석 v2 (spec 15장 · 2026-04-25) ────────────
 * 도메인별 5 슬롯 매트릭스 × {action, note}.
 * 비교 분석 (ComparisonAnalysis) 5축 점수표 UX 와 시각적 쌍둥이.
 * DB persist X (휘발) · SSE step 1 event + done item 에만 포함.
 *
 * 백엔드:
 *   - clarify_edit_intent (gemma4) → intent: 영어 1-2문장 정제
 *   - analyze_edit_source (qwen2.5vl) → domain + slots 매트릭스
 *
 * 도메인별 슬롯 키:
 *   person:        face_expression / hair / attire / body_pose / background
 *   object_scene:  subject / color_material / layout_composition /
 *                  background_setting / mood_style
 */

export type EditDomain = "person" | "object_scene";
export type EditSlotAction = "edit" | "preserve";

export interface EditSlotEntry {
  action: EditSlotAction;
  /** 한 줄 설명 — qwen2.5vl 출력 언어 자율 (입력 언어 추종) */
  note: string;
}

export interface EditVisionAnalysis {
  domain: EditDomain;
  /** gemma4 정제 영어 intent (1-2 문장). 정제 실패 시 빈 문자열. */
  intent: string;
  /** qwen2.5vl 요약 1줄 (영어 권장). DB visionDescription 으로도 저장됨. */
  summary: string;
  /** 도메인에 따라 키 셋 다름. 항상 5개 키 유지 (백엔드가 강제). */
  slots: Record<string, EditSlotEntry>;

  provider: "ollama" | "fallback";
  fallback: boolean;
  analyzedAt: number;
  visionModel: string;
}

/** 인물 도메인 슬롯 키 순서 (UI 렌더 순서) */
export const PERSON_SLOT_ORDER: readonly string[] = [
  "face_expression",
  "hair",
  "attire",
  "body_pose",
  "background",
] as const;

/** 물체·풍경 도메인 슬롯 키 순서 */
export const OBJECT_SCENE_SLOT_ORDER: readonly string[] = [
  "subject",
  "color_material",
  "layout_composition",
  "background_setting",
  "mood_style",
] as const;

/** 슬롯 키 → 한국어 UI 라벨 매핑 */
export const SLOT_LABELS_KO: Record<string, string> = {
  // person
  face_expression: "얼굴/표정",
  hair: "헤어",
  attire: "의상/액세서리",
  body_pose: "바디/포즈",
  background: "배경/환경",
  // object_scene
  subject: "주체",
  color_material: "색·재질",
  layout_composition: "배치·구도",
  background_setting: "배경·환경",
  mood_style: "분위기·스타일",
};

/* ──────────── Vision Compare Analysis (임의 두 이미지 비교 · 신규) ──────────── */

/** Vision Compare 5축 점수 (composition/color/subject/mood/quality) */
export interface VisionCompareScores {
  composition: number | null;
  color: number | null;
  subject: number | null;
  mood: number | null;
  quality: number | null;
}

export type VisionCompareComments = {
  [K in keyof VisionCompareScores]: string;
};

/** Vision Compare 분석 단일 결과 (휘발 · DB 저장 X).
 *
 * 2026-04-26 v2.1 (Codex+Claude 안):
 *   - transform_prompt: B 를 만드려면 A 에 적용할 t2i 변형 지시
 *   - uncertain: 비전이 비교 못한 영역 명시 (없으면 빈 문자열)
 */
export interface VisionCompareAnalysis {
  scores: VisionCompareScores;
  overall: number;
  comments_en: VisionCompareComments;
  comments_ko: VisionCompareComments;
  summary_en: string;
  summary_ko: string;
  /** v2.1: A → B 변형 t2i 프롬프트 (영문) */
  transform_prompt_en?: string;
  /** v2.1: 변형 프롬프트 한국어 번역 */
  transform_prompt_ko?: string;
  /** v2.1: 비교 못한 영역 (영문) */
  uncertain_en?: string;
  /** v2.1: 비교 못한 영역 한국어 번역 */
  uncertain_ko?: string;
  provider: "ollama" | "fallback";
  fallback: boolean;
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
  /** Adult LoRA 토글 여부 */
  adult?: boolean;

  /* ── Edit 모드 비교 분석 (mode === "edit" 일 때만 채워짐) ── */
  /** 원본 이미지 영구 경로 (예: "/images/studio/edit-source/{id}.png").
   *  옛 row 또는 generate/video 결과는 undefined. */
  sourceRef?: string;
  /** 비교 분석 결과. 분석 안 한 경우 undefined. */
  comparisonAnalysis?: ComparisonAnalysis;
  /** Edit 비전 구조 분석 (Phase 1 · 휘발). 이 세션에서 실행된 edit 에만 포함.
   *  옛 히스토리 로드 시 undefined → AiEnhanceCard 는 visionDescription 단락으로 폴백. */
  editVisionAnalysis?: EditVisionAnalysis;
  /** spec 19 후속 (v6 캐싱) — Edit 한 사이클의 clarify_edit_intent 결과 캐시.
   *  비교 분석 (compare-analyze) 이 historyItemId 받으면 이 값을 재사용해
   *  gemma4 cold start 비용 ~5초 절약. mode === "edit" 만 채워짐. */
  refinedIntent?: string;
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
  /** hideGeneratePrompts=false 시: 사전 검수 모달에서 사용자가 확정한 영문 프롬프트 */
  preUpgradedPrompt?: string;
  /** upgrade-only 단계에서 이미 얻은 Claude 힌트 — 빈 배열 [] 도 "조사 완료" 로 간주됨.
   *  undefined 이면 백엔드가 research 플래그대로 조사 실행. */
  preResearchHints?: string[];
  /** 활성 스타일 LoRA id (GENERATE_STYLES.id 와 매칭). null/undefined 면 미사용.
   *  백엔드가 sampling 파라미터 자동 override + LoRA 체인에 추가 + Lightning 강제 OFF. */
  styleId?: string | null;
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
      /** step 1 done 에서 도착하는 구조 분석 (Phase 1 · 2026-04-25 · 휘발) */
      editVisionAnalysis?: EditVisionAnalysis;
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

/** psutil 실패 시 null. RAM total 0 이면 null 처리. */
export interface RamSnapshot {
  usedGb: number;
  totalGb: number;
}

/**
 * 백엔드 /process/status 폴링 결과 — Ollama/ComfyUI + 통합 자원 메트릭.
 * 각 메트릭 필드는 측정 실패 시 null (프론트에서 누락 = 미표시).
 *
 * 2026-04-26: SystemMetrics (CPU/GPU/VRAM/RAM 4-bar UI) 도입 — vram 단독에서
 * cpu/gpu/ram 까지 확장.
 * 2026-04-26 (후속): vramBreakdown 추가 — 헤더 80% 임계 오버레이 (프로세스별 VRAM + 로드 모델).
 */
export interface ProcessStatusSnapshot {
  ollamaRunning: boolean;
  comfyuiRunning: boolean;
  /** nvidia-smi 실패 시 null. */
  vram: VramSnapshot | null;
  /** psutil 실패 시 null. RAM total 0 이면 null 처리. */
  ram: RamSnapshot | null;
  /** nvidia-smi GPU utilization % — 실패 시 null. */
  gpuPercent: number | null;
  /** psutil CPU utilization % — 실패 시 null. */
  cpuPercent: number | null;
  /** 프로세스별 VRAM 분류 + 로드 모델 정보. 측정 실패 시 null. */
  vramBreakdown: VramBreakdown | null;
}

/**
 * 헤더 VRAM 임계 오버레이용 — ComfyUI / Ollama / 기타 분류.
 * 백엔드 /process/status 응답의 vram_breakdown 필드 그대로 매핑 (snake → camel).
 */
export interface VramBreakdown {
  comfyui: {
    /** ComfyUI 프로세스가 점유 중인 VRAM (GB) */
    vramGb: number;
    /** 마지막 dispatch 모델 (display_name) — 추적값. 비어있을 수 있음. */
    models: string[];
    /** 마지막 dispatch 모드: "generate" | "edit" | "video" */
    lastMode?: string;
  };
  ollama: {
    /** Ollama 프로세스가 점유 중인 VRAM (GB) */
    vramGb: number;
    /** 현재 로드된 모델 목록 (keep_alive=0 정책에선 보통 빈 배열) */
    models: Array<{
      name: string;
      sizeVramGb: number;
      /** keep_alive 남은 초 — null 이면 파싱 실패 또는 만료 */
      expiresInSec: number | null;
    }>;
  };
  /** 기타 GPU 사용 프로세스 합산 (브라우저 GPU 가속 등) */
  otherGb: number;
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

/**
 * Vision Recipe v2 9 슬롯 (2026-04-26 spec 18 — Codex+Claude 공동).
 *
 * 폴백 row (옛 v1 또는 JSON 파싱 실패):
 *   - 모든 v2 필드가 빈 문자열 → 프론트는 positive_prompt 가 비면 v1 (en/ko) 카드로 폴백.
 */
export interface VisionRecipeV2 {
  /** 사람 읽는 2-3 문장 영문 요약 (한국어 번역은 ko 필드에 들어감). */
  summary: string;
  /** t2i 재생성용 150-300 단어 영문 프롬프트 (subject FIRST ordering · comprehensive · 2026-04-26 동기화). */
  positivePrompt: string;
  /** 콤마 분리 회피 리스트 — image-specific + 표준 t2i guards. */
  negativePrompt: string;
  composition: string;
  subject: string;
  clothingOrMaterials: string;
  environment: string;
  lightingCameraStyle: string;
  /** 추정 금지 — 비전이 모르는 영역 명시. */
  uncertain: string;
}

export interface VisionAnalysisResponse extends VisionRecipeV2 {
  /** 옛 호환: v2 성공 시 summary + positive_prompt 합본, 폴백 시 옛 단락. */
  en: string;
  /** 한글 번역 — v2 성공 시 summary 번역, 폴백 시 단락 번역. ko=null 은 번역 실패. */
  ko: string | null;
  /** 백엔드: "ollama" | "fallback". Mock 경로: "mock". */
  provider: "ollama" | "fallback" | "mock";
  fallback: boolean;
  /** PIL 측정값. 추출 실패 시 0. */
  width: number;
  height: number;
  sizeBytes: number;
}
