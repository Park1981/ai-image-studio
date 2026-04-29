/**
 * /prompt-flow (인덱스) — generate 페이지로 redirect.
 *
 * 옛 단일 통합 페이지(809줄)는 redesign 으로 [mode] 동적 라우트로 분리되었습니다.
 * 인덱스 진입 시 generate 페이지로 자동 이동합니다.
 */

import { redirect } from "next/navigation";

export default function PromptFlowIndexPage(): never {
  redirect("/prompt-flow/generate");
}
