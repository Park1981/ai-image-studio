/**
 * /prompt-flow/video — 영상 생성 도움말 페이지.
 *
 * 다이어그램은 placeholder (오빠가 직접 작업 중). 옛 통합 페이지의 video
 * 섹션 콘텐츠 (6단계 + ruleBlock + Example) 통합.
 */

import PromptFlowShell from "@/components/prompt-flow/PromptFlowShell";
import { PROMPT_FLOW_CONTENT } from "@/lib/prompt-flow-content";

export const metadata = {
  title: "영상 생성 흐름 · AI Image Studio",
  description: "한 장의 기준 이미지에서 출발해 5초 영상으로 확장되는 단계별 흐름.",
};

export default function VideoPromptFlowPage() {
  return <PromptFlowShell content={PROMPT_FLOW_CONTENT.video} />;
}
