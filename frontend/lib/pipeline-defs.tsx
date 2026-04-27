/**
 * pipeline-defs — 진행 모달 stage 정의의 단일 진실의 출처 (single source of truth).
 *
 * 2026-04-27 (Phase 1) 신설.
 *
 * 설계 문서: docs/superpowers/specs/2026-04-27-progress-store-unify-design.md
 *
 * 핵심 약속:
 *   - 백엔드 emit 의 stage type 값 = 이 배열 의 StageDef.type 값 (1:1 매칭)
 *   - 동기화 누락 시 row 안 보임 (= 검증 게이트로 잡음)
 *   - StageDef.enabled 콜백으로 동적 on/off (research 토글 / 자동 기동 / gemma4 비활성화 등)
 *   - StageDef.renderDetail 콜백으로 stage 별 보조 박스 (vision description / finalPrompt 등)
 *
 * 차후 확장 시 이 파일만 수정하면 3 mode 자동 일관:
 *   - gemma4 off → enabled: (c) => !c.gemma4Off 한 줄
 *   - VRAM 정리 → 새 StageDef 한 항목
 *   - 새 mode (예: upscale) → PIPELINE_DEFS 에 항목 추가
 */

import type { ReactNode } from "react";
import EditVisionBlock from "@/components/studio/EditVisionBlock";
import { DetailBox } from "@/components/studio/progress/DetailBox";
import type { EditVisionAnalysis, HistoryMode } from "@/lib/api/types";

/* ────────────────────────────────────────────────
 * 타입 정의
 * ──────────────────────────────────────────────── */

/** 진행 모달 1 stage 의 정의. PIPELINE_DEFS 안에 mode 별로 배열로 들어감. */
export interface StageDef {
  /** SSE 의 stage event type 과 1:1 매칭 (백엔드 emit 의 "type" 필드) */
  type: string;
  /** 사용자 표시용 stage 이름 */
  label: string;
  /** 모델/엔진 정보 (선택). Edit/Video 의 step 보조 라벨 ("qwen2.5vl:7b" 등) */
  subLabel?: string;
  /** 동적 on/off — false 면 timeline 에서 row 자체 안 그림. 미정의 시 항상 표시 (true). */
  enabled?: (ctx: PipelineCtx) => boolean;
  /** stage 가 done 상태일 때 row 아래 보조 박스 렌더 (선택).
   *  vision description / finalPrompt 등. payload 가 없거나 적절한 필드 없으면 null 반환. */
  renderDetail?: (payload: StagePayload, ctx: PipelineCtx) => ReactNode;
}

/** Timeline 이 enabled / renderDetail 호출 시 넘기는 컨텍스트 묶음. */
export interface PipelineCtx {
  /** Generate 의 research 토글 — claude-research stage 표시 게이트 */
  research?: boolean;
  /** 자동 기동 워밍업 stage 가 도착했는지 — comfyui-warmup row 표시 게이트.
   *  Phase 5 자동 기동 도입 시 백엔드가 stage emit → store 가 stageHistory 에 추가 → 이 값 true. */
  warmupArrived?: boolean;
  /** 차후 도입 예정: gemma4 비활성화 시 gemma4-upgrade / prompt-merge stage 숨김 */
  gemma4Off?: boolean;
  /** Edit 의 휘발 분석 데이터 — vision-analyze stage 의 chip UI 렌더 */
  editVisionAnalysis?: EditVisionAnalysis | null;
  /** ProgressModal 의 prompt 토글 — Edit 의 detail 박스 표시/숨김 */
  hideEditPrompts?: boolean;
  /** ProgressModal 의 prompt 토글 — Generate 의 detail 박스 표시/숨김 */
  hideGeneratePrompts?: boolean;
}

/** 백엔드가 SSE 로 보내는 stage event payload — 임의 필드 (mode 별 다름). */
export type StagePayload = Record<string, unknown>;

/* ────────────────────────────────────────────────
 * PIPELINE_DEFS — 진실의 출처
 * ──────────────────────────────────────────────── */

export const PIPELINE_DEFS: Record<HistoryMode, StageDef[]> = {
  /* ── Generate (6 stage · 기존 GEN_STAGE_ORDER 와 1:1 매칭) ── */
  generate: [
    { type: "prompt-parse", label: "프롬프트 해석" },
    {
      type: "claude-research",
      label: "Claude 조사",
      subLabel: "최신 프롬프트 팁",
      enabled: (c) => c.research === true,
    },
    { type: "gemma4-upgrade", label: "gemma4 업그레이드" },
    { type: "workflow-dispatch", label: "워크플로우 전달" },
    {
      type: "comfyui-warmup",
      label: "ComfyUI 깨우는 중",
      subLabel: "최대 30초",
      // Phase 5 (자동 기동) 도입 시 백엔드가 emit → 자동 표시.
      enabled: (c) => c.warmupArrived === true,
    },
    { type: "comfyui-sampling", label: "ComfyUI 샘플링" },
    { type: "postprocess", label: "후처리" },
  ],

  /* ── Edit (6 stage · 기존 4 step 매핑 + warmup) ── */
  edit: [
    {
      type: "vision-analyze",
      label: "비전 분석",
      subLabel: "qwen2.5vl:7b",
      renderDetail: (p, c) => {
        if (c.hideEditPrompts) return null;
        // 구조 분석 (editVisionAnalysis) 있으면 chip UI, 없으면 description 단락.
        // editVisionAnalysis 는 store 의 휘발 필드 — payload 가 아니라 ctx 에서.
        if (c.editVisionAnalysis) {
          return (
            <EditVisionBlock
              analysis={c.editVisionAnalysis}
              showHeader={false}
            />
          );
        }
        const description = p.description as string | undefined;
        if (description) {
          return (
            <DetailBox kind="info" title="비전 설명">
              {description}
            </DetailBox>
          );
        }
        return null;
      },
    },
    {
      type: "comfyui-warmup",
      label: "ComfyUI 깨우는 중",
      subLabel: "최대 30초",
      enabled: (c) => c.warmupArrived === true,
    },
    {
      type: "prompt-merge",
      label: "프롬프트 통합",
      subLabel: "gemma4-un",
      renderDetail: (p, c) => {
        if (c.hideEditPrompts) return null;
        const finalPrompt = p.finalPrompt as string | undefined;
        const finalPromptKo = p.finalPromptKo as string | undefined;
        const provider = p.provider as string | undefined;
        return (
          <>
            {finalPrompt && (
              <DetailBox
                kind={provider === "fallback" ? "warn" : "info"}
                title={`최종 프롬프트 (${provider ?? "?"})`}
              >
                {finalPrompt}
              </DetailBox>
            )}
            {finalPromptKo && (
              <DetailBox kind="muted" title="한국어 번역">
                {finalPromptKo}
              </DetailBox>
            )}
          </>
        );
      },
    },
    { type: "param-extract", label: "사이즈/스타일 추출", subLabel: "auto" },
    {
      type: "comfyui-sampling",
      label: "ComfyUI 샘플링",
      subLabel: "qwen-image-edit-2511",
    },
    { type: "save-output", label: "결과 저장" },
  ],

  /* ── Video (6 stage · 기존 5 step 매핑 + warmup) ── */
  video: [
    {
      type: "vision-analyze",
      label: "이미지 비전 분석",
      subLabel: "qwen2.5vl:7b",
      renderDetail: (p) => {
        const description = p.description as string | undefined;
        return description ? (
          <DetailBox kind="info" title="비전 설명">
            {description}
          </DetailBox>
        ) : null;
      },
    },
    {
      type: "comfyui-warmup",
      label: "ComfyUI 깨우는 중",
      subLabel: "최대 30초",
      enabled: (c) => c.warmupArrived === true,
    },
    {
      type: "prompt-merge",
      label: "영상 프롬프트 통합",
      subLabel: "gemma4-un",
      renderDetail: (p) => {
        const finalPrompt = p.finalPrompt as string | undefined;
        const finalPromptKo = p.finalPromptKo as string | undefined;
        const provider = p.provider as string | undefined;
        return (
          <>
            {finalPrompt && (
              <DetailBox
                kind={provider === "fallback" ? "warn" : "info"}
                title={`LTX 프롬프트 (${provider ?? "?"})`}
              >
                {finalPrompt}
              </DetailBox>
            )}
            {finalPromptKo && (
              <DetailBox kind="muted" title="한국어 번역">
                {finalPromptKo}
              </DetailBox>
            )}
          </>
        );
      },
    },
    {
      type: "workflow-build",
      label: "워크플로우 구성",
      subLabel: "LTX i2v builder",
    },
    {
      type: "comfyui-sampling",
      label: "ComfyUI 샘플링",
      subLabel: "ltx-2.3-22b-fp8",
    },
    { type: "save-output", label: "MP4 저장", subLabel: "h264 인코딩" },
  ],
};
