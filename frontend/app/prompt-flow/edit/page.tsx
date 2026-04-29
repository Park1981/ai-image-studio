/**
 * /prompt-flow/edit — 이미지 수정 도움말 페이지.
 *
 * 다이어그램은 placeholder (오빠가 직접 작업 중). 옛 통합 페이지의 edit
 * 섹션 콘텐츠 (7단계 + 매트릭스 슬롯 + 참조 이미지 역할 + Example) 통합.
 */

import PromptFlowShell from "@/components/prompt-flow/PromptFlowShell";
import { PROMPT_FLOW_CONTENT } from "@/lib/prompt-flow-content";

export const metadata = {
  title: "이미지 수정 흐름 · AI Image Studio",
  description: "원본 이미지와 수정 지시를 분석해 유지/변경을 분리하는 단계별 흐름.",
};

export default function EditPromptFlowPage() {
  return <PromptFlowShell content={PROMPT_FLOW_CONTENT.edit} />;
}
