/**
 * /prompt-flow/[mode] 동적 라우트 (edit / video 전용).
 *
 * generate 는 /prompt-flow/generate/page.tsx 가 specific 으로 우선되어
 * 본 동적 라우트는 매칭하지 않습니다 (Next.js 라우팅 우선순위).
 *
 * mode 가 알려진 값(generate/edit/video)이 아니면 notFound() 로 404 처리.
 */

import { notFound } from "next/navigation";
import PromptFlowLayout from "@/components/prompt-flow/PromptFlowLayout";
import {
  PROMPT_FLOW_CONTENT,
  isFlowMode,
  type FlowMode,
} from "@/lib/prompt-flow-content";

type RouteParams = {
  mode: string;
};

export function generateStaticParams(): RouteParams[] {
  // generate 는 별도 페이지가 우선이지만, 정적 export 시 안전하게 모든 모드를 포함.
  return [{ mode: "generate" }, { mode: "edit" }, { mode: "video" }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { mode } = await params;
  if (!isFlowMode(mode)) {
    return { title: "Prompt Flow" };
  }
  const content = PROMPT_FLOW_CONTENT[mode as FlowMode];
  return {
    title: `${content.meta.title} · AI Image Studio`,
    description: content.meta.subtitle,
  };
}

export default async function PromptFlowModePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { mode } = await params;
  if (!isFlowMode(mode)) {
    notFound();
  }
  const content = PROMPT_FLOW_CONTENT[mode as FlowMode];
  return <PromptFlowLayout content={content} />;
}
