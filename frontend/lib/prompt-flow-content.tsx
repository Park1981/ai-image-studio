/**
 * Prompt Flow 도움말 페이지 콘텐츠 단일 출처 (2026-04-29 v2 redesign).
 *
 * 옛 단일 통합 페이지(page.tsx 809줄) 를 mode 별 풀 페이지로 분리하면서
 * 데이터를 이쪽으로 이관. 각 mode 페이지(/prompt-flow/{mode})는 이 데이터를
 * 받아 PromptFlowShell 로 렌더.
 *
 * 톤 규칙: 사용자 노출 텍스트는 모두 한국어 존댓말 (공식체).
 */

import type { IconName } from "@/components/ui/Icon";

// ─────────────────────────────────────────
//  Types
// ─────────────────────────────────────────

export type FlowMode = "generate" | "edit" | "video";

export type StepAccent = "blue" | "green" | "amber";

export type FlowStep = {
  index: string;
  title: string;
  simple: string;
  detail: string;
  accent: StepAccent;
};

export type JourneyStep = {
  icon: IconName;
  title: string;
  body: string;
};

export type ExampleCardData = {
  label: string;
  text: string;
};

export type RuleBlockData = {
  title: string;
  body: string;
};

export type ReferenceRuleData = {
  label: string;
  text: string;
};

export type ModeMeta = {
  title: string;
  subtitle: string;
  eyebrow: string;
  /** 메뉴 카드와 동일한 Hero 배경 자산 (/menu/{mode}.png). */
  modeImage: string;
  /** Hero 우측 모드 아이콘. */
  modeIcon: IconName;
  /** 앱 진입 경로 (CTA 버튼). */
  appPath: string;
  /** 도움말 페이지 anchor id (옛 호환 — sticky scroll 시 사용). */
  anchorId: string;
};

export type ModeContent = {
  mode: FlowMode;
  meta: ModeMeta;
  /** mode 별 단계 카드 (generate=6 / edit=7 / video=6). */
  steps: FlowStep[];
  /** 우측 사이드 룰 블록 (이미지+rule 형식). */
  ruleBlocks: RuleBlockData[];
  /** 하단 예시 변환 카드 4개. */
  examples: ExampleCardData[];
  /** edit 전용: 매트릭스 슬롯 (인물 / 물체·풍경). */
  matrixSlots?: { preserve: string[]; scene: string[] };
  /** edit 전용: 참조 이미지 역할 4종. */
  referenceRules?: ReferenceRuleData[];
};

// ─────────────────────────────────────────
//  공통 — Journey 5단계 (모든 mode 페이지 상단 공통 노출)
// ─────────────────────────────────────────

export const journey: JourneyStep[] = [
  {
    icon: "edit",
    title: "요청 입력",
    body: "생성·수정·영상 모두 사용자가 입력하신 문장에서 시작합니다.",
  },
  {
    icon: "wand",
    title: "프롬프트 정리",
    body: "AI 엔진이 읽기 쉬운 영어 문장으로 다듬어 드립니다.",
  },
  {
    icon: "scan-eye",
    title: "이미지 이해",
    body: "수정·영상 모드는 업로드하신 이미지를 먼저 분석해 기준을 잡습니다.",
  },
  {
    icon: "grid",
    title: "규칙 적용",
    body: "유지할 부분, 변경할 부분, 스타일 같은 조건을 정리합니다.",
  },
  {
    icon: "sparkle",
    title: "결과 생성",
    body: "최종 프롬프트가 이미지·영상 엔진으로 전달됩니다.",
  },
];

// ─────────────────────────────────────────
//  Generate
// ─────────────────────────────────────────

const generateSteps: FlowStep[] = [
  {
    index: "01",
    title: "원하는 장면을 문장으로 입력합니다",
    simple: "예) 비 오는 골목에서 네온사인을 보는 여성.",
    detail:
      "처음 입력은 짧아도 괜찮습니다. 앱이 이 문장을 원본 요청으로 보관하고, 별도로 최종 프롬프트를 만들어 줍니다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "캔버스 정보를 함께 알려줍니다",
    simple: "선택하신 비율과 해상도를 프롬프트 정리 단계에 함께 전달합니다.",
    detail:
      "가로 사진·세로 사진·정사각형 같은 캔버스 정보를 알면 구도 표현이 더 안정적으로 만들어집니다.",
    accent: "green",
  },
  {
    index: "03",
    title: "필요하면 조사 힌트를 더합니다",
    simple: "Claude 프롬프트 조사를 켜시면 스타일·조명 힌트가 참고자료로 추가됩니다.",
    detail:
      "이 힌트는 명령이 아닌 참고 자료입니다. 원래 요청은 바꾸지 않고 표현만 풍부하게 만드는 용도로 사용됩니다.",
    accent: "amber",
  },
  {
    index: "04",
    title: "이미지용 영어 프롬프트로 다듬습니다",
    simple: "짧은 입력이 조명·구도·질감·분위기가 담긴 영어 문장으로 변환됩니다.",
    detail:
      "단, 입력에 미니멀·심플 같은 표현이 포함되면 과도한 디테일을 일부러 추가하지 않고 간결하게 유지합니다.",
    accent: "blue",
  },
  {
    index: "05",
    title: "확인하신 프롬프트는 다시 변경하지 않습니다",
    simple: "업그레이드 확인 모달에서 확정하신 문장은 그대로 생성 단계로 전달됩니다.",
    detail:
      "이미 검토를 마친 최종 문장을 AI에 다시 맡기지 않으므로, 시간이 단축되고 의미가 의도치 않게 바뀌는 일도 줄어듭니다.",
    accent: "green",
  },
  {
    index: "06",
    title: "스타일과 금지어를 붙여 엔진으로 전송합니다",
    simple: "스타일 프리셋이 활성화되어 있으면 트리거 문구와 LoRA 설정이 함께 적용됩니다.",
    detail:
      "최종 영어 프롬프트는 positive 로, 기본 품질 방지 문구는 negative 로 ComfyUI 에 전달됩니다.",
    accent: "amber",
  },
];

// ─────────────────────────────────────────
//  Edit
// ─────────────────────────────────────────

const editSteps: FlowStep[] = [
  {
    index: "01",
    title: "원본 요청을 받습니다",
    simple: "예) 배경만 밤거리로 바꾸고 인물은 그대로 유지해 주세요.",
    detail:
      "사용자가 작성하신 원문은 그대로 보관됩니다. 히스토리에 원문도 함께 저장되어 나중에 다시 확인하실 수 있습니다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "수정 의도를 한 번 정리합니다",
    simple: "느슨한 한국어 요청을 명확한 영어 지시로 다듬는 단계입니다.",
    detail:
      "이 단계는 단순 번역이 아닌 의도 정리입니다. 무엇을 변경할지, 무엇을 유지할지 먼저 선명하게 만든 뒤 다음 단계로 넘어갑니다.",
    accent: "green",
  },
  {
    index: "03",
    title: "원본 이미지를 분석해 매트릭스로 나눕니다",
    simple: "이미지를 얼굴·머리·의상·자세·배경 같은 슬롯 단위로 분석합니다.",
    detail:
      "인물 사진이면 인물용 슬롯, 물체나 풍경이면 물체·장면용 슬롯을 사용합니다. 비전 모델이 도메인을 자동으로 판별합니다.",
    accent: "blue",
  },
  {
    index: "04",
    title: "변경할 슬롯과 유지할 슬롯을 분리합니다",
    simple: "변경할 슬롯은 구체적으로 작성하고, 유지할 슬롯은 자세히 묘사하지 않습니다.",
    detail:
      "유지할 부분을 너무 자세히 다시 묘사하면 생성 엔진이 그 부분까지 새로 그릴 위험이 있어, '원본 그대로 유지' 같은 일반 표현만 전달합니다.",
    accent: "amber",
  },
  {
    index: "05",
    title: "참조 이미지가 있으면 역할을 제한합니다",
    simple: "image2(참조)는 얼굴·의상·배경·스타일 중 지정하신 역할만 가져옵니다.",
    detail:
      "예를 들어 의상 참조라면 image2 의 옷만 가져오고, 얼굴·자세·배경은 image1 을 그대로 유지하도록 가드가 적용됩니다.",
    accent: "green",
  },
  {
    index: "06",
    title: "최종 프롬프트를 한 번 더 점검합니다",
    simple: "참조 이미지를 사용하는데 최종 문장에 image2 가 빠지면 자동으로 보강합니다.",
    detail:
      "이 안전장치 덕분에 참조 이미지를 올리셨지만 프롬프트가 그 이미지를 무시하는 상황을 줄여 줍니다.",
    accent: "amber",
  },
  {
    index: "07",
    title: "생성 엔진으로 전달합니다",
    simple: "최종 프롬프트와 image1, 필요하면 image2 를 함께 ComfyUI 로 보냅니다.",
    detail:
      "결과에는 원본 요청·최종 프롬프트·한국어 번역·분석 요약이 함께 저장되어 다시 확인하실 수 있습니다.",
    accent: "blue",
  },
];

// ─────────────────────────────────────────
//  Video
// ─────────────────────────────────────────

const videoSteps: FlowStep[] = [
  {
    index: "01",
    title: "첫 장면 이미지와 영상 요청을 받습니다",
    simple: "예) 이 사진에서 카메라가 천천히 앞으로 다가가게 해 주세요.",
    detail:
      "영상 모드는 텍스트만으로 시작하지 않고, 업로드하신 이미지가 첫 프레임의 기준점이 됩니다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "이미 다듬어진 문장이면 보강을 건너뜁니다",
    simple: "스킵 옵션을 켜시면 입력하신 문장을 그대로 최종 영상 프롬프트로 사용합니다.",
    detail:
      "이미지 분석과 프롬프트 보강 단계를 생략해 빠르게 진행됩니다. 다만 이때는 직접 작성하신 문장의 품질이 결과에 더 직접적으로 영향을 줍니다.",
    accent: "amber",
  },
  {
    index: "03",
    title: "스킵하지 않으면 이미지를 먼저 분석합니다",
    simple: "비전 AI가 첫 장면의 인물·배경·조명·구도를 요약합니다.",
    detail:
      "이 요약이 있어야 영상이 시작 프레임과 비슷하게 이어지고, 도중에 다른 사람이나 장소로 튀는 현상을 줄일 수 있습니다.",
    accent: "green",
  },
  {
    index: "04",
    title: "영상용 문장으로 다시 작성합니다",
    simple: "움직임·카메라·조명 변화·분위기를 한 문단으로 정리합니다.",
    detail:
      "LTX 영상 모델은 소리 없이 화면을 만드는 모델입니다. 그래서 음악·대사·소리 묘사보다는 보이는 움직임을 중심으로 프롬프트가 구성됩니다.",
    accent: "blue",
  },
  {
    index: "05",
    title: "첫 프레임 보존 문구를 넣습니다",
    simple: "같은 얼굴·같은 인물·같은 구도 같은 정체성 보존 문구가 강하게 포함됩니다.",
    detail:
      "영상 생성에서 가장 위험한 현상은 인물이나 물체가 도중에 다른 모습으로 변하는 것이라, 정체성 보존 문구가 사용자 지시보다 먼저 강하게 들어갑니다.",
    accent: "green",
  },
  {
    index: "06",
    title: "영상 엔진에 맞게 크기와 샘플링을 준비합니다",
    simple: "원본 비율을 유지해 리사이즈한 뒤, 5초 영상 샘플링으로 전달합니다.",
    detail:
      "최종 프롬프트와 첫 이미지가 함께 LTX 로 전달되어 MP4 가 생성되고, 사용된 프롬프트와 함께 히스토리에 저장됩니다.",
    accent: "amber",
  },
];

// ─────────────────────────────────────────
//  PROMPT_FLOW_CONTENT — 단일 출처
// ─────────────────────────────────────────

export const PROMPT_FLOW_CONTENT: Record<FlowMode, ModeContent> = {
  generate: {
    mode: "generate",
    meta: {
      title: "이미지 생성은 이렇게 정리됩니다",
      subtitle:
        "생성 모드는 원본 이미지가 없어서, 사용자가 입력하신 문장을 좋은 촬영 지시문처럼 다듬는 흐름이 중심입니다.",
      eyebrow: "Generate Flow",
      modeImage: "/menu/generate.png",
      modeIcon: "image",
      appPath: "/generate",
      anchorId: "generate-flow",
    },
    steps: generateSteps,
    ruleBlocks: [
      {
        title: "생성에서 바뀌는 것",
        body: "짧은 요청이 구도·카메라 느낌·조명·질감이 포함된 영어 프롬프트로 변환됩니다.",
      },
      {
        title: "다시 보강하지 않는 경우",
        body: "확인 모달에서 직접 수정하신 최종 프롬프트는 그대로 사용됩니다. 그래서 의도치 않은 재해석을 줄여 줍니다.",
      },
    ],
    examples: [
      { label: "사용자 입력", text: "비 오는 골목의 네온 감성." },
      {
        label: "추가 맥락",
        text: "세로 이미지라면 인물 중심 구도, 가로 이미지라면 배경 공간을 더 넓게 잡도록 컨텍스트가 전달됩니다.",
      },
      {
        label: "정리된 프롬프트",
        text: "A cinematic rainy alley scene with neon reflections, wet pavement, moody lighting, and a clear subject-focused composition.",
      },
      {
        label: "엔진 전달",
        text: "최종 영어 문장 + 선택하신 스타일 + 기본 negative prompt 가 함께 전달됩니다.",
      },
    ],
  },
  edit: {
    mode: "edit",
    meta: {
      title: "이미지 수정은 이렇게 움직입니다",
      subtitle:
        "핵심은 \"어디를 변경할지\" 보다 \"어디를 건드리면 안 되는지\" 까지 함께 정리하는 것입니다.",
      eyebrow: "Edit Flow",
      modeImage: "/menu/edit.png",
      modeIcon: "edit",
      appPath: "/edit",
      anchorId: "edit-flow",
    },
    steps: editSteps,
    ruleBlocks: [
      {
        title: "분석표는 이렇게 구성됩니다",
        body: "AI 가 원본을 보고 5칸짜리 표로 나눕니다. 각 칸에는 변경 또는 유지가 표시됩니다.",
      },
      {
        title: "가장 중요한 안전장치",
        body: "유지 칸은 자세히 묘사하지 않고 \"그대로 유지\" 라고만 전달합니다. 그래야 원본의 정상적인 부분을 다시 그리는 실수를 줄일 수 있습니다.",
      },
    ],
    matrixSlots: {
      preserve: ["얼굴/표정", "머리", "의상", "몸/자세", "배경"],
      scene: ["주제", "색/재질", "구도", "배경/장소", "분위기"],
    },
    referenceRules: [
      { label: "얼굴", text: "얼굴 정체성만 image2 에서 가져옵니다." },
      { label: "의상", text: "옷과 액세서리만 가져옵니다." },
      { label: "배경", text: "배경만 image2 환경으로 변경합니다." },
      { label: "스타일", text: "색감과 조명 분위기만 적용합니다." },
    ],
    examples: [
      {
        label: "사용자 입력",
        text: "배경만 밤거리로 변경하고 인물 얼굴과 의상은 그대로 유지해 주세요.",
      },
      {
        label: "정리된 의도",
        text: "Change only the background to a night city street. Keep the person, face, and clothing unchanged.",
      },
      {
        label: "분석표",
        text: "얼굴 유지 · 의상 유지 · 자세 유지 · 배경 변경",
      },
      {
        label: "최종 프롬프트",
        text: "Replace only the background with a realistic night city street while preserving the same person, face, clothing, pose, lighting balance, and all unchanged details from image1.",
      },
    ],
  },
  video: {
    mode: "video",
    meta: {
      title: "영상 생성은 첫 장면을 기준으로 움직임을 만듭니다",
      subtitle:
        "영상은 프롬프트만 보는 것이 아니라, 업로드하신 이미지를 첫 프레임으로 삼고 그 상태에서 어떤 움직임을 줄지 정리합니다.",
      eyebrow: "Video Flow",
      modeImage: "/menu/video.png",
      modeIcon: "play",
      appPath: "/video",
      anchorId: "video-flow",
    },
    steps: videoSteps,
    ruleBlocks: [
      {
        title: "영상에서 가장 중요한 것",
        body: "첫 이미지의 얼굴·피사체·구도가 유지되어야 합니다. 그래서 움직임보다 정체성 보존 문구가 먼저 적용됩니다.",
      },
      {
        title: "스킵 옵션의 의미",
        body: "스킵을 켜면 빠르지만, 이미지 분석과 프롬프트 보강을 거치지 않습니다. 이미 잘 다듬어진 영어 영상 프롬프트일 때 사용하시는 옵션입니다.",
      },
    ],
    examples: [
      { label: "사용자 입력", text: "카메라가 천천히 앞으로 다가가게 해 주세요." },
      {
        label: "이미지 이해",
        text: "첫 장면의 인물·표정·배경·조명 상태를 먼저 요약합니다.",
      },
      {
        label: "영상 프롬프트",
        text: "A slow cinematic dolly-in toward the same subject, preserving the face, pose, lighting, and first-frame composition.",
      },
      {
        label: "결과 저장",
        text: "MP4 결과와 최종 영상 프롬프트·한국어 번역·이미지 설명이 히스토리에 함께 저장됩니다.",
      },
    ],
  },
};

export function isFlowMode(value: string): value is FlowMode {
  return value === "generate" || value === "edit" || value === "video";
}
