/**
 * Model Presets - ComfyUI 워크플로우에 대응하는 프론트엔드 상수
 *
 * 백엔드 워크플로우 원본:
 *  - backend/workflows/qwen_image_2512.json       (생성 · Subgraph id c3c58f7e-…)
 *  - backend/workflows/qwen_image_edit_2511.json  (수정 · Subgraph id cdb2cf24-…)
 *
 * 이 파일은 두 JSON 의 subgraph 설정·기본값·LoRA 체인을 "거울" 역할로 고정.
 * 나중에 서버에서 /api/models 로 동적으로 받아오면 대체하거나 병행 가능.
 *
 * ⚠️ 주의: JSON 을 수정하면 여기도 반드시 같이 수정할 것.
 */

/* ── LoRA 엔트리 ── */
export interface LoraEntry {
  /** safetensors 파일명 (loras/ 하위) */
  name: string;
  /** 강도 (0.0 ~ 1.0+) */
  strength: number;
  /** 역할: lightning = Lightning 4-step 가속용 (토글로 제어). extra = 상시 적용 */
  role: "lightning" | "extra";
}

/* ── 종횡비 프리셋 (Qwen Image 2512 권장 사이즈) ── */
export const ASPECT_RATIOS = [
  { label: "1:1", width: 1328, height: 1328 },
  { label: "16:9", width: 1664, height: 928 },
  { label: "9:16", width: 928, height: 1664 },
  { label: "4:3", width: 1472, height: 1104 },
  { label: "3:4", width: 1104, height: 1472 },
  { label: "3:2", width: 1584, height: 1056 },
  { label: "2:3", width: 1056, height: 1584 },
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export type AspectRatioLabel = AspectRatio["label"];

export function getAspect(label: AspectRatioLabel): AspectRatio {
  return ASPECT_RATIOS.find((r) => r.label === label) ?? ASPECT_RATIOS[0];
}

/* ──────────────────────────────────────────────────────
   생성 모델: Qwen Image 2512 (Text-to-Image)
   원본 워크플로우: qwen_image_2512.json
   ────────────────────────────────────────────────────── */
export const GENERATE_MODEL = {
  displayName: "Qwen Image 2512",
  tag: "GGUF·FP8",
  workflow: "qwen_image_2512.json",
  subgraphId: "c3c58f7e-2004-43ae-8b06-a956294bf7f4",

  /** 체크포인트 / 인코더 / VAE 파일명 (ComfyUI/models/ 하위) */
  files: {
    unet: "qwen_image_2512_fp8_e4m3fn.safetensors",
    clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    vae: "qwen_image_vae.safetensors",
  },

  /** LoRA 체인 (순서대로 적용) */
  loras: [
    {
      name: "Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors",
      strength: 1,
      role: "lightning",
    },
    {
      name: "FemNude_qwen-image-2512_epoch30.safetensors",
      strength: 1,
      role: "extra",
    },
  ] satisfies LoraEntry[],

  /** 기본(풀 퀄리티) 샘플링 설정 */
  defaults: {
    aspect: "1:1" as AspectRatioLabel,
    steps: 50,
    cfg: 4.0,
    sampler: "euler",
    scheduler: "simple",
    /** ModelSamplingAuraFlow shift */
    shift: 3.1,
    /** EmptySD3LatentImage batch_size */
    batchSize: 1,
    /** 기본 seed (워크플로우 저장된 값, 'randomize' 로 매 실행 교체) */
    seed: 464857551335368,
  },

  /** Lightning 모드 (토글 ON 시).
   *  2026-04-25 픽스: 4-step 의 살짝 블러 → 8/1.5 로 디테일 향상 확인.
   *  사용자 비교 평가 (4/1.0 · 6/1.2 · 8/1.5) 결과 8/1.5 채택.
   *  백엔드 backend/studio/presets.py 의 GENERATE_MODEL.lightning 와 동기화 유지. */
  lightning: {
    steps: 8,
    cfg: 1.5,
  },

  /** 네거티브 프롬프트 (워크플로우 고정) */
  negativePrompt:
    "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲",
} as const;

/* ──────────────────────────────────────────────────────
   수정 모델: Qwen Image Edit 2511 (Image Editing)
   원본 워크플로우: qwen_image_edit_2511.json
   ────────────────────────────────────────────────────── */
export const EDIT_MODEL = {
  displayName: "Qwen Image Edit 2511",
  tag: "BF16",
  workflow: "qwen_image_edit_2511.json",
  subgraphId: "cdb2cf24-c432-439b-b5c8-5f69838580c9",

  files: {
    unet: "qwen_image_edit_2511_bf16.safetensors",
    clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
    vae: "qwen_image_vae.safetensors",
  },

  /** LoRA 체인 */
  loras: [
    {
      name: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
      strength: 1,
      role: "lightning",
    },
    {
      name: "SexGod_CouplesNudity_QwenEdit_2511_v1.safetensors",
      strength: 0.7,
      role: "extra",
    },
  ] satisfies LoraEntry[],

  defaults: {
    /** 퀄리티 참고 표: Qwen 권장 40, ComfyUI 권장 20 (워크플로우는 40 채택) */
    steps: 40,
    cfg: 4.0,
    sampler: "euler",
    scheduler: "simple",
    shift: 3.1,
    /** CFGNorm 패치 강도 */
    cfgNorm: 1,
    batchSize: 1,
    seed: 988400431880911,
  },

  lightning: {
    steps: 4,
    cfg: 1.0,
  },

  /** FluxKontextMultiReferenceLatentMethod 모드 (positive/negative 양쪽) */
  referenceLatentMethod: "index_timestep_zero",

  /** 참조 이미지는 FluxKontextImageScale 로 자동 스케일 (사용자 입력 불요) */
  autoScaleReferenceImage: true,

  /**
   * 최대 참조 이미지 수 (workflow 의 image / image2 / image3 슬롯)
   * 현재 UI 는 1장(주 참조)만 노출. 2/3번 슬롯은 backend 에서 비워서 전달.
   */
  maxReferenceImages: 3,
} as const;

/* ──────────────────────────────────────────────────────
   Ollama 기본 모델 — Settings 초기값과 백엔드 DEFAULT_OLLAMA_ROLES 싱크
   ────────────────────────────────────────────────────── */
/**
 * 프론트 Settings 의 초기값 단일 진입점.
 * 백엔드 `backend/studio/presets.py::DEFAULT_OLLAMA_ROLES` 와 일치해야 함.
 * 여기서 변경 시 백엔드도 반드시 같이 수정할 것.
 */
export const DEFAULT_OLLAMA_MODELS = {
  /** 텍스트 업그레이드 + 번역 (gemma4 계열) */
  text: "gemma4-un:latest",
  /** 이미지 비전 설명 (Edit 모드 파이프라인 step 1) */
  vision: "qwen2.5vl:7b",
} as const;

/* ──────────────────────────────────────────────────────
   공용 유틸
   ────────────────────────────────────────────────────── */

/** role === "extra" 인 LoRA 수 (UI 에 "+ N" 표기용) */
export function countExtraLoras(
  model: typeof GENERATE_MODEL | typeof EDIT_MODEL,
): number {
  return model.loras.filter((l) => l.role === "extra").length;
}

/** Lightning 토글 상태에 따라 현재 적용 중인 LoRA 목록 */
export function activeLoras(
  model: typeof GENERATE_MODEL | typeof EDIT_MODEL,
  lightningOn: boolean,
): LoraEntry[] {
  return model.loras.filter((l) => (l.role === "lightning" ? lightningOn : true));
}
