/**
 * /prompt-flow/generate — 이미지 생성 도움말 페이지.
 *
 * GenerateUseCaseDiagram (UC Generate Pipeline) + 옛 통합 페이지의 generate
 * 섹션 콘텐츠 (단계 카드 + ruleBlock + Example) 통합.
 */

import PromptFlowShell from "@/components/prompt-flow/PromptFlowShell";
import GenerateUseCaseDiagram from "@/components/prompt-flow/GenerateUseCaseDiagram";
import { PROMPT_FLOW_CONTENT } from "@/lib/prompt-flow-content";

export const metadata = {
  title: "이미지 생성 흐름 · AI Image Studio",
  description: "자연어 한 줄이 ComfyUI 프롬프트가 되기까지의 단계별 흐름과 분기 다이어그램.",
};

export default function GeneratePromptFlowPage() {
  return (
    <PromptFlowShell
      content={PROMPT_FLOW_CONTENT.generate}
      diagram={<GenerateUseCaseDiagram />}
    />
  );
}
