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
      // 2026-04-25: FemNude_qwen-image-2512_epoch30 → female-body-beauty_qwen
      // 백엔드 backend/studio/presets.py 의 GENERATE_MODEL.loras 와 동기화 유지.
      name: "female-body-beauty_qwen.safetensors",
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
  // 2026-05-03 qwen2.5vl:7b → qwen3-vl:8b (ChatGPT 정공법 · backend presets.py 동기화)
  vision: "qwen3-vl:8b",
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

/* ──────────────────────────────────────────────────────
   Generate 스타일 LoRA — 토글로 활성화하는 추가 LoRA + sampling override
   2026-04-25: 단일 entry (asian_influencer) 시작. 차후 추가 시 배열에 객체만 push.
   백엔드 backend/studio/presets.py::GENERATE_STYLES 와 1:1 동기화 유지.
   ────────────────────────────────────────────────────── */
export interface GenerateStyle {
  /** 식별자 — POST /generate body 의 styleId 값 */
  id: string;
  /** UI 라벨 */
  displayName: string;
  /** UI 서브라벨 (예: "Euler A · 25step · cfg 6.0") */
  description: string;
  /** Lightning 토글과 호환 여부 — true 면 활성 시 Lightning 자동 OFF */
  incompatibleWithLightning: boolean;
}

// 2026-04-25 (1차 시도 후 보류): asian_influencer (blue_hair_q2512) 효과 미약 → 제거.
// 시스템 (GenerateStyle 타입, useGenerateStore.styleId) 은 유지 — 차후 추가 시 객체만 push.
export const GENERATE_STYLES: GenerateStyle[] = [];

/** Lightning 토글 상태에 따라 현재 적용 중인 LoRA 목록 */
export function activeLoras(
  model: typeof GENERATE_MODEL | typeof EDIT_MODEL,
  lightningOn: boolean,
): LoraEntry[] {
  return model.loras.filter((l) => (l.role === "lightning" ? lightningOn : true));
}

/* ──────────────────────────────────────────────────────
   영상 모델: Wan 2.2 i2v + LTX Video 2.3 듀얼 (2026-05-03)

   원본 워크플로우:
    - Wan 2.2: ComfyUI Desktop · Q6_K GGUF + LightX2V LoRA (Next Diffusion 가이드 기반)
    - LTX 2.3: backend/workflows/video_ltx2_3_i2v.json (Comfy-Org 공식 템플릿)

   백엔드 backend/studio/presets.py 의 LTX_VIDEO_PRESET / WAN22_VIDEO_PRESET 와 동기화 유지.
   spec: docs/superpowers/specs/2026-05-03-video-model-selection-wan22.md §5.1
   ────────────────────────────────────────────────────── */

export type VideoModelId = "wan22" | "ltx";

export interface VideoModelPresetMirror {
  id: VideoModelId;
  /** UI 라벨 (모델 세그먼트 / History 배지) */
  displayName: string;
  /** 보조 라벨 (예: "Q6_K · GGUF") */
  tag: string;
  /** 모델별 sweet spot 시작 width (사용자 미override 시 자동 채움) */
  defaultWidth: number;
  defaultHeight: number;
  /** 영상 frame 수 (Wan: 81 @ 16fps ≈ 5초 / LTX: 126 @ 25fps ≈ 5초) */
  defaultLength: number;
  /** 학습 fps · CreateVideo 노드의 fps widget 값으로 사용 */
  baseFps: number;
  /** Lightning 토글 ON 시 sampling */
  lightning: { steps: number; cfg: number };
  /** Lightning 토글 OFF 시 sampling (정밀 모드) */
  precise: { steps: number; cfg: number };
  /** UI 도움말 (해상도 슬라이더 옆 표시) */
  recommendedSweetSpot?: string;
  /** UI 배너 (VRAM 부담 알림) */
  vramHint?: string;
  /** ETA 텍스트 (Lightning ON/OFF 별 1세대 추정 시간) */
  speedHint: { lightning: string; precise: string };
}

export const VIDEO_MODEL_PRESETS: Record<VideoModelId, VideoModelPresetMirror> = {
  wan22: {
    id: "wan22",
    displayName: "Wan 2.2 i2v",
    tag: "Q6_K · GGUF",
    defaultWidth: 832,
    defaultHeight: 480,
    defaultLength: 81, // 5초 @ 16fps + 1 (실측 검증된 값)
    baseFps: 16, // Wan 2.2 학습 fps (이걸로 출력 안 하면 영상 속도 부자연)
    lightning: { steps: 4, cfg: 1.0 },
    precise: { steps: 20, cfg: 3.5 },
    recommendedSweetSpot: "832×480 ~ 1024×576",
    vramHint: "high → low 순차 swap · 16GB 안에 fit",
    speedHint: { lightning: "약 5분", precise: "약 20분" },
  },
  ltx: {
    id: "ltx",
    displayName: "LTX Video 2.3",
    tag: "22B · A/V · upscale",
    defaultWidth: 1024,
    defaultHeight: 576,
    defaultLength: 126, // 5초 @ 25fps + 1 (LTX 공식 템플릿 값)
    baseFps: 25,
    lightning: { steps: 4, cfg: 1.0 },
    precise: { steps: 30, cfg: 1.0 },
    recommendedSweetSpot: "1024×576 ~ 1536 long-edge",
    vramHint: "29GB fp8 · 16GB 환경은 sysmem swap (느림)",
    speedHint: { lightning: "5~10분", precise: "25~40분" },
  },
};

/** 기본 영상 모델 — settings persist + 페이지 진입 시 적용 (spec §2 결정 #1) */
export const DEFAULT_VIDEO_MODEL_ID: VideoModelId = "wan22";

/** model_id → 미러 lookup (안전 fallback: Wan22) */
export function getVideoPresetMirror(
  id: VideoModelId | string | undefined | null,
): VideoModelPresetMirror {
  if (id === "ltx") return VIDEO_MODEL_PRESETS.ltx;
  return VIDEO_MODEL_PRESETS.wan22;
}
