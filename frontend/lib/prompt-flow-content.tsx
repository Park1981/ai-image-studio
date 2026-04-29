/**
 * Prompt Flow 콘텐츠 데이터 (2026-04-29 redesign).
 *
 * 각 모드(generate/edit/video) 의 도움말 페이지 콘텐츠 단일 출처.
 *  - generate: 별도 풀 인터랙티브 페이지(app/prompt-flow/generate/page.tsx) 보유.
 *    여기서는 메인 카드 메타 + 인덱스용 메타만 정의.
 *  - edit / video: 동적 라우트 app/prompt-flow/[mode]/page.tsx 가 이 데이터로 렌더.
 *
 * 톤 규칙: 사용자 노출 텍스트는 모두 한국어 존댓말 (공식체).
 *  - "~합니다" / "~확인하실 수 있습니다" / "예) ~"
 *  - 비교군 baseline (root prompt-flow/page.tsx) 의 반말 → 모두 변환.
 */

import type { IconName } from "@/components/ui/Icon";

export type FlowMode = "generate" | "edit" | "video";

export type StepAccent = "blue" | "green" | "amber";

export type FlowStep = {
  index: string;
  title: string;
  simple: string;
  detail: string;
  accent: StepAccent;
};

export type KeyPoint = {
  icon: IconName;
  title: string;
  body: string;
};

export type ModeMeta = {
  title: string;
  subtitle: string;
  /** Hero 배경 이미지 — 메인 메뉴 카드와 동일 자산. */
  heroBg: string;
  /** Hero 액센트 — 디자인 토큰 (--accent / --green / --amber) 매핑. */
  heroAccent: StepAccent;
  /** Hero 한 줄 흐름 요약. */
  heroFlowLabel: string;
  /** 모드 진입 페이지 경로 (메인 카드와 동일). */
  appPath: string;
};

export type ModeExtra =
  | {
      type: "edit-matrix";
      title: string;
      body: string;
      items: { label: string; text: string }[];
    }
  | {
      type: "video-options";
      title: string;
      body: string;
      items: { label: string; text: string }[];
    }
  | {
      type: "reference-roles";
      title: string;
      body: string;
      items: { label: string; text: string }[];
    };

export type ModeContent = {
  mode: FlowMode;
  meta: ModeMeta;
  steps?: FlowStep[];
  keyPoints?: KeyPoint[];
  extras?: ModeExtra[];
  /** generate 만 사용 — 동적 라우트가 아닌 별도 풀 페이지로 redirect. */
  externalHref?: string;
};

// ─────────────────────────────────────────
//  edit 6단계 (사용자 노출 — 모두 존댓말)
// ─────────────────────────────────────────
const editSteps: FlowStep[] = [
  {
    index: "01",
    title: "원본 이미지와 수정 요청을 받습니다",
    simple: "예) 배경만 밤거리로 바꿔 주세요. 인물은 그대로 유지해 주세요.",
    detail:
      "사용자가 작성한 원문은 그대로 보관됩니다. 히스토리에 원문도 함께 저장되어 나중에 다시 확인하실 수 있습니다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "수정 의도를 영어 한 문장으로 정리합니다",
    simple: "느슨한 한국어 요청을 명확한 영어 지시로 다듬는 단계입니다.",
    detail:
      "이 단계는 단순 번역이 아니라 의도 정리입니다. 무엇을 바꿀지, 무엇을 유지할지 먼저 선명하게 만든 뒤 다음 단계로 넘어갑니다.",
    accent: "green",
  },
  {
    index: "03",
    title: "원본 이미지를 분석해 매트릭스로 나눕니다",
    simple: "이미지를 얼굴·머리·의상·몸/자세·배경 같은 슬롯으로 나누어 이해합니다.",
    detail:
      "인물 사진과 물체/풍경 사진은 서로 다른 슬롯 체계를 사용합니다. 비전 모델이 자동으로 도메인을 판별하고 적합한 슬롯으로 분석합니다.",
    accent: "blue",
  },
  {
    index: "04",
    title: "변경할 슬롯과 유지할 슬롯을 분리합니다",
    simple: "변경할 슬롯은 구체적으로 작성하고, 유지할 슬롯은 자세히 묘사하지 않습니다.",
    detail:
      "유지할 부분을 너무 자세히 다시 묘사하면 생성 엔진이 그 부분까지 새로 그릴 위험이 있습니다. 그래서 유지할 슬롯에는 \"원본 그대로 유지\" 같은 일반적인 표현만 넘깁니다.",
    accent: "amber",
  },
  {
    index: "05",
    title: "참조 이미지가 있으면 역할을 제한합니다",
    simple: "image2(참조)는 지정한 역할(얼굴·의상·배경·스타일) 의 측면만 가져옵니다.",
    detail:
      "예를 들어 의상 참조라면 image2 의 옷만 반영하고, 얼굴·자세·배경은 image1 을 유지하도록 가드합니다. 잘못된 측면이 섞이지 않도록 negative prompt 도 자동으로 추가됩니다.",
    accent: "green",
  },
  {
    index: "06",
    title: "최종 프롬프트를 한 번 더 점검한 뒤 생성합니다",
    simple: "참조 이미지를 사용하는데 image2 가 누락되면 자동으로 보강합니다.",
    detail:
      "이 안전장치 덕분에 참조 이미지를 올렸지만 최종 프롬프트가 image2 를 무시하는 상황을 줄입니다. 점검이 끝난 프롬프트와 image1, image2 가 ComfyUI 로 전달되어 결과가 생성됩니다.",
    accent: "amber",
  },
];

// ─────────────────────────────────────────
//  video 6단계 (사용자 노출 — 모두 존댓말)
// ─────────────────────────────────────────
const videoSteps: FlowStep[] = [
  {
    index: "01",
    title: "기준 이미지와 영상 요청을 받습니다",
    simple: "예) 이 사진에서 카메라가 천천히 앞으로 다가가게 해 주세요.",
    detail:
      "영상 모드는 텍스트만으로 시작하지 않고, 업로드한 이미지가 첫 프레임의 기준점이 됩니다. 사용자가 적은 영상 방향(움직임·분위기) 도 함께 보관됩니다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "이미 다듬어진 문장이면 보강을 건너뜁니다",
    simple: "스킵 옵션을 켜면 작성한 문장을 그대로 최종 영상 프롬프트로 사용합니다.",
    detail:
      "이미지 분석과 프롬프트 보강 단계를 생략하므로 빠르게 영상 생성으로 진입합니다. 다만 이때는 직접 작성한 문장의 품질이 결과 품질에 더 직접적으로 영향을 줍니다.",
    accent: "amber",
  },
  {
    index: "03",
    title: "스킵하지 않으면 기준 이미지를 먼저 분석합니다",
    simple: "비전 모델이 첫 장면의 인물·배경·조명·구도를 요약합니다.",
    detail:
      "이 요약이 있어야 영상이 시작 프레임과 비슷하게 이어지고, 도중에 다른 사람이나 장소로 튀는 현상을 줄일 수 있습니다.",
    accent: "green",
  },
  {
    index: "04",
    title: "영상용 한 문단으로 다시 작성합니다",
    simple: "움직임·카메라·조명 변화·분위기를 60~150단어 영문 한 문단으로 정리합니다.",
    detail:
      "LTX-2.3 영상 모델은 소리 없이 화면을 만드는 모델입니다. 그래서 음악·대사·소리 묘사보다는 보이는 움직임을 중심으로 프롬프트가 구성됩니다.",
    accent: "blue",
  },
  {
    index: "05",
    title: "첫 프레임 보존 문구를 강하게 넣습니다",
    simple: "같은 얼굴·같은 인물·같은 구도 같은 정체성 보존 문구를 강제로 포함합니다.",
    detail:
      "영상 생성에서 가장 위험한 현상은 인물이나 물체의 형상이 도중에 변하는 것입니다. 정체성 보존 문구는 그래서 사용자 지시보다 먼저 강하게 들어갑니다.",
    accent: "green",
  },
  {
    index: "06",
    title: "영상 엔진에 맞게 크기와 샘플링을 준비합니다",
    simple: "원본 비율을 유지해 8배수 해상도로 리사이즈한 뒤, 5초 25fps 샘플링으로 넘깁니다.",
    detail:
      "최종 프롬프트와 첫 이미지가 함께 LTX-2.3 으로 전달되어 126프레임 MP4 가 생성됩니다. 결과는 사용된 프롬프트·한국어 번역과 함께 히스토리에 저장됩니다.",
    accent: "amber",
  },
];

// ─────────────────────────────────────────
//  공통 keyPoints (각 mode 별 핵심 포인트 3개)
// ─────────────────────────────────────────
const editKeyPoints: KeyPoint[] = [
  {
    icon: "sparkle",
    title: "원본은 항상 보존",
    body: "유지할 슬롯을 명시하면 생성 엔진이 그 부분을 다시 그리지 않도록 가드가 적용됩니다.",
  },
  {
    icon: "scan-eye",
    title: "참조 이미지는 역할 제한",
    body: "참조 이미지는 얼굴·의상·배경·스타일 중 한 역할만 가져오도록 자동 제한됩니다.",
  },
  {
    icon: "grid",
    title: "수정 과정도 함께 저장",
    body: "원문·최종 프롬프트·한국어 번역·매트릭스 분석이 결과 이미지와 함께 기록됩니다.",
  },
];

const videoKeyPoints: KeyPoint[] = [
  {
    icon: "image",
    title: "한 장의 이미지에서 시작",
    body: "영상 모드는 첫 프레임 기준 이미지가 반드시 필요합니다. 정체성을 따라 영상이 이어집니다.",
  },
  {
    icon: "wand",
    title: "움직임 묘사가 핵심",
    body: "카메라·동작·조명 변화 같은 움직임을 구체적으로 적을수록 결과가 의도에 가까워집니다.",
  },
  {
    icon: "grid",
    title: "결과도 기록과 함께",
    body: "생성된 MP4 와 사용한 영상 프롬프트가 히스토리에 함께 저장되어 다시 확인하실 수 있습니다.",
  },
];

// ─────────────────────────────────────────
//  PROMPT_FLOW_CONTENT — 단일 진실 출처
// ─────────────────────────────────────────
export const PROMPT_FLOW_CONTENT: Record<FlowMode, ModeContent> = {
  generate: {
    mode: "generate",
    meta: {
      title: "이미지 생성 흐름",
      subtitle:
        "자연어 한 줄이 정교한 영문 프롬프트로 다듬어져 ComfyUI 로 전달되는 전체 과정을 확인하실 수 있습니다.",
      heroBg: "/menu/generate.png",
      heroAccent: "blue",
      heroFlowLabel: "입력 → 정리 → 보강 → 최종 프롬프트 → 생성 → 저장",
      appPath: "/generate",
    },
    externalHref: "/prompt-flow/generate",
  },
  edit: {
    mode: "edit",
    meta: {
      title: "이미지 수정 흐름",
      subtitle:
        "원본 이미지와 수정 지시를 함께 분석해, 유지할 부분과 변경할 부분을 분리한 뒤 안전하게 수정합니다.",
      heroBg: "/menu/edit.png",
      heroAccent: "green",
      heroFlowLabel: "원본 → 수정 요청 → 분석 → 유지/변경 분리 → 최종 프롬프트 → 결과",
      appPath: "/edit",
    },
    steps: editSteps,
    keyPoints: editKeyPoints,
    extras: [
      {
        type: "edit-matrix",
        title: "매트릭스 슬롯",
        body: "이미지 도메인에 따라 슬롯 5개로 나누어 분석합니다.",
        items: [
          { label: "인물 사진", text: "얼굴/표정 · 머리 · 의상 · 몸/자세 · 배경" },
          { label: "물체·풍경 사진", text: "주제 · 색/재질 · 구도 · 배경/장소 · 분위기" },
        ],
      },
      {
        type: "reference-roles",
        title: "참조 이미지 역할",
        body: "image2(참조 이미지) 는 4가지 역할 중 하나로만 사용됩니다.",
        items: [
          { label: "얼굴", text: "얼굴 정체성만 가져옵니다. 머리·의상·배경은 원본 유지." },
          { label: "의상", text: "옷과 액세서리만 가져옵니다. 얼굴·자세·배경은 원본 유지." },
          { label: "배경", text: "배경/환경만 가져옵니다. 인물 정체성·자세는 원본 유지." },
          { label: "스타일", text: "색감·조명·분위기만 가져옵니다. 피사체와 구도는 원본 유지." },
        ],
      },
    ],
  },
  video: {
    mode: "video",
    meta: {
      title: "영상 생성 흐름",
      subtitle:
        "한 장의 기준 이미지에서 출발해 5초 분량 영상으로 확장되는 과정을 확인하실 수 있습니다.",
      heroBg: "/menu/video.png",
      heroAccent: "amber",
      heroFlowLabel: "이미지 → 영상 방향 → 프롬프트 정리 → 보존 문구 → 영상 생성 → 저장",
      appPath: "/video",
    },
    steps: videoSteps,
    keyPoints: videoKeyPoints,
    extras: [
      {
        type: "video-options",
        title: "선택 가능한 옵션",
        body: "영상 생성 화면에서 다음 옵션을 선택하실 수 있습니다.",
        items: [
          {
            label: "빠른 생성 (Lightning)",
            text: "Lightning LoRA 로 4스텝 샘플링을 사용해 영상 생성 시간을 단축합니다.",
          },
          {
            label: "프롬프트 보강 스킵",
            text: "이미 다듬어진 프롬프트가 있으면 분석·보강 단계를 건너뛰고 곧바로 영상으로 진입합니다.",
          },
          {
            label: "결과 한국어 번역 표시",
            text: "최종 영문 프롬프트의 한국어 번역을 결과와 함께 보여 줍니다.",
          },
        ],
      },
    ],
  },
};

/** 안전한 mode 매핑 — URL 파라미터 검증 시 사용. */
export function isFlowMode(value: string): value is FlowMode {
  return value === "generate" || value === "edit" || value === "video";
}
