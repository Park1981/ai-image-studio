/**
 * /prompt-flow/generate — 이미지 생성 도움말 페이지.
 *
 * 다이어그램은 DiagramSlot 가 자동으로 /prompt-flow/generate-flow.png 임베드.
 * 옛 GenerateUseCaseDiagram React 컴포넌트는 보존 (cherry-pick 가능, git history).
 */

import PromptFlowShell from "@/components/prompt-flow/PromptFlowShell";
import { PROMPT_FLOW_CONTENT } from "@/lib/prompt-flow-content";

export const metadata = {
  title: "이미지 생성 흐름 · AI Image Studio",
  description: "자연어 한 줄이 ComfyUI 프롬프트가 되기까지의 단계별 흐름과 분기 다이어그램.",
};

export default function GeneratePromptFlowPage() {
  return <PromptFlowShell content={PROMPT_FLOW_CONTENT.generate} />;
}
