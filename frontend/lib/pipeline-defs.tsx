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

/**
 * PipelineMode — 진행 모달이 처리하는 모든 모드 union.
 *
 * Phase 6 (2026-04-27): vision / compare 도 진행 모달 통일에 합류.
 *   - HistoryMode (generate/edit/video) = 결과가 history 에 저장
 *   - vision = history 에 저장 (Vision Analyzer 결과)
 *   - compare = 휘발 (Vision Compare 결과 + Edit 비교 분석 — 둘 다 store 내부만)
 *
 * 단순히 union 으로 표현 — vision/compare 는 PIPELINE_DEFS 에서만 stage 정의 가짐.
 */
export type PipelineMode = HistoryMode | "vision" | "compare";

/* ────────────────────────────────────────────────
 * 타입 정의
 * ──────────────────────────────────────────────── */

/** 진행 모달 1 stage 의 정의. PIPELINE_DEFS 안에 mode 별로 배열로 들어감. */
export interface StageDef {
  /** SSE 의 stage event type 과 1:1 매칭 (백엔드 emit 의 "type" 필드) */
  type: string;
  /** 사용자 표시용 stage 이름 */
  label: string;
  /**
   * 모델/엔진 정보 (선택). Edit/Video 의 step 보조 라벨 ("qwen2.5vl:7b" 등).
   *
   * Phase 2 (2026-05-01) — 콜백 형태도 지원. ctx 의 promptMode 등 동적 값 분기 시 사용.
   * 정밀 모드일 때 "gemma4-un · 정밀 (30~60초)" 처럼 라벨 변경.
   */
  subLabel?: string | ((ctx: PipelineCtx) => string);
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
  /** ProgressModal 의 prompt 토글 — Video 의 detail 박스 표시/숨김 (Phase 4 후속 · 2026-04-27) */
  hideVideoPrompts?: boolean;
  /** Compare 모드 (Edit context · 캐시 미스 시) refined_intent stage 도착 여부.
   *  Vision Compare 메뉴는 emit 안 함 → row 안 보임. Phase 6 (2026-04-27). */
  intentRefineArrived?: boolean;
  /**
   * gemma4 보강 모드 (Phase 2 · 2026-05-01).
   * 4 stage 의 subLabel 분기에 사용 — generate gemma4-upgrade / edit·video prompt-merge /
   * compare intent-refine. 정밀 모드일 때 "gemma4-un · 정밀 (30~60초)" 표기.
   * vision translation stage 는 정책상 항상 fast (spec §4.4) → 분기 X.
   */
  promptMode?: "fast" | "precise";
  /**
   * 영상 모델 (Phase 5 follow-up · 2026-05-03 · spec §4.2 후속).
   * mode === "video" 일 때만 채워짐 (그 외 undefined).
   * 3 stage 의 subLabel/title 분기에 사용:
   *   - workflow-dispatch: "Wan 2.2 i2v builder" / "LTX i2v builder"
   *   - comfyui-sampling: "wan2.2-14b-q6_k" / "ltx-2.3-22b-fp8"
   *   - prompt-merge.detail: "Wan 프롬프트" / "LTX 프롬프트"
   */
  videoModelId?: "wan22" | "ltx";
  /**
   * 비전 모델 (2026-05-04 · subLabel 동적화).
   * Edit/Video/Compare 의 vision-analyze / vision-pair stage subLabel 표시.
   * useSettingsStore.visionModel persist 값 그대로 — 사용자가 Vision 페이지에서
   * 토글한 모델 (qwen3-vl:8b / qwen3-vl:8b-thinking-q8_0) 이 그대로 반영됨.
   * mode === "edit" / "video" / "compare" 에서 채워짐 (그 외 undefined).
   */
  visionModel?: string;
}

/**
 * gemma4-un 사용 stage 의 subLabel 콜백 (Phase 2 · 2026-05-01).
 * 4 stage 가 동일 함수 재사용 — generate.gemma4-upgrade / edit.prompt-merge /
 * video.prompt-merge / compare.intent-refine.
 */
const gemmaSubLabel = (c: PipelineCtx): string =>
  c.promptMode === "precise" ? "gemma4-un · 정밀 (30~60초)" : "gemma4-un";

/**
 * Video stage 의 model_id 분기 콜백 (Phase 5 follow-up · 2026-05-03).
 * spec §4.2 의 두 모델 (Wan 2.2 / LTX 2.3) 빌더/체크포인트 라벨 분리.
 */
const videoBuilderSubLabel = (c: PipelineCtx): string =>
  c.videoModelId === "wan22" ? "Wan 2.2 i2v builder" : "LTX i2v builder";

const videoModelSubLabel = (c: PipelineCtx): string =>
  c.videoModelId === "wan22" ? "wan2.2-14b-q6_k" : "ltx-2.3-22b-fp8";

/**
 * Vision 모델 stage 의 subLabel 콜백 (2026-05-04).
 * Edit/Video/Compare 의 vision-analyze / vision-pair stage 표시.
 * settings.visionModel 따라 사용자 토글한 모델 (qwen3-vl:8b 또는 thinking) 동적 표기.
 * 미정의 시 default qwen3-vl:8b 폴백 (store 빈 상태 안전망).
 */
const visionSubLabel = (c: PipelineCtx): string =>
  c.visionModel ?? "qwen3-vl:8b";

const videoPromptTitleLabel = (c: PipelineCtx): string =>
  c.videoModelId === "wan22" ? "Wan" : "LTX";

/** 백엔드가 SSE 로 보내는 stage event payload — 임의 필드 (mode 별 다름). */
export type StagePayload = Record<string, unknown>;

/* ────────────────────────────────────────────────
 * PIPELINE_DEFS — 진실의 출처
 * ──────────────────────────────────────────────── */

export const PIPELINE_DEFS: Record<PipelineMode, StageDef[]> = {
  /* ── Generate (7 stage · 라벨 체계화 2026-04-27) ── */
  generate: [
    { type: "prompt-parse", label: "프롬프트 해석" },
    {
      type: "claude-research",
      label: "프롬프트 조사",
      subLabel: "Claude · 최신 팁",
      enabled: (c) => c.research === true,
    },
    { type: "gemma4-upgrade", label: "프롬프트 강화", subLabel: gemmaSubLabel },
    { type: "workflow-dispatch", label: "워크플로우 설정" },
    {
      type: "comfyui-warmup",
      label: "ComfyUI 깨우는 중",
      subLabel: "최대 30초",
      // Phase 5 (자동 기동) 도입 시 백엔드가 emit → 자동 표시.
      enabled: (c) => c.warmupArrived === true,
    },
    {
      type: "comfyui-sampling",
      label: "이미지 생성",
      subLabel: "qwen-image-2512",
    },
    { type: "save-output", label: "결과 저장" },
  ],

  /* ── Edit (6 stage · 라벨 체계화 2026-04-27) ── */
  edit: [
    {
      type: "vision-analyze",
      label: "이미지 분석",
      subLabel: visionSubLabel,
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
      subLabel: gemmaSubLabel,
      renderDetail: (p, c) => {
        if (c.hideEditPrompts) return null;
        const finalPrompt = p.finalPrompt as string | undefined;
        const finalPromptKo = p.finalPromptKo as string | undefined;
        const provider = p.provider as string | undefined;
        return (
          <>
            {finalPrompt && (
              <DetailBox
                // Phase 2 (2026-05-01) — fallback / fallback-precise-failed 둘 다 warn 톤
                kind={provider?.startsWith("fallback") ? "warn" : "info"}
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
      label: "이미지 수정",
      subLabel: "qwen-image-edit-2511",
    },
    { type: "save-output", label: "결과 저장" },
  ],

  /* ── Video (6 stage · 라벨 체계화 2026-04-27) ── */
  video: [
    {
      type: "vision-analyze",
      label: "이미지 분석",
      subLabel: visionSubLabel,
      renderDetail: (p, c) => {
        // Phase 4 후속 (2026-04-27): hideVideoPrompts 토글 분기 (Edit 와 동일).
        if (c.hideVideoPrompts) return null;
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
      label: "프롬프트 통합",
      subLabel: gemmaSubLabel,
      renderDetail: (p, c) => {
        if (c.hideVideoPrompts) return null;
        const finalPrompt = p.finalPrompt as string | undefined;
        const finalPromptKo = p.finalPromptKo as string | undefined;
        const provider = p.provider as string | undefined;
        // Phase 5 follow-up (2026-05-03) — title 도 model 별 분기.
        const modelLabel = videoPromptTitleLabel(c);
        return (
          <>
            {finalPrompt && (
              <DetailBox
                // Phase 2 (2026-05-01) — fallback / fallback-precise-failed 둘 다 warn 톤
                kind={provider?.startsWith("fallback") ? "warn" : "info"}
                title={`${modelLabel} 프롬프트 (${provider ?? "?"})`}
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
      // 백엔드 video.py 가 emit 하는 stage type 과 1:1 매칭 — workflow-dispatch.
      // Phase 5 follow-up (2026-05-03) — model_id 분기 라벨 (spec §4.2 듀얼).
      type: "workflow-dispatch",
      label: "워크플로우 설정",
      subLabel: videoBuilderSubLabel,
    },
    {
      type: "comfyui-sampling",
      label: "영상 생성",
      subLabel: videoModelSubLabel,
    },
    { type: "save-output", label: "MP4 저장", subLabel: "h264 인코딩" },
  ],

  /* ── Vision Analyzer (4 stage · qwen3-vl + gemma4 합성 + gemma4 번역) — Phase 6 ── */
  vision: [
    { type: "vision-encoding", label: "이미지 인코딩", subLabel: "browser" },
    {
      // 2026-04-27 라벨 일관화: vision-call → vision-analyze (edit/video 와 동일 type)
      type: "vision-analyze",
      label: "이미지 분석",
      subLabel: "qwen3-vl:8b",
      // Edit/Video 패턴 일관 — 이미지 분석 완료 시 summary 박스 표시 (provider="fallback" → warn 톤)
      renderDetail: (p) => {
        const summary = p.summary as string | undefined;
        const provider = p.provider as string | undefined;
        if (!summary) return null;
        return (
          <DetailBox
            // Phase 2 (2026-05-01) — fallback / fallback-precise-failed 둘 다 warn 톤
            kind={provider?.startsWith("fallback") ? "warn" : "info"}
            title={`분석 요약 (${provider ?? "?"})`}
          >
            {summary}
          </DetailBox>
        );
      },
    },
    {
      // Phase 5 (2026-05-03) — 2단계 파이프라인 합성 신호.
      // 백엔드 _signal("prompt-synthesize") → SSE type "prompt-synthesize" → 이 엔트리.
      type: "prompt-synthesize",
      label: "프롬프트 합성",
      subLabel: "gemma4-un",
    },
    {
      // gemma4 번역 — 미래 토글 OFF 시 enabled 한 줄로 자동 숨김 (옵션 B 통일 가치).
      type: "translation",
      label: "한국어 번역",
      subLabel: "gemma4-un",
      enabled: (c) => !c.gemma4Off,
      renderDetail: (p) => {
        const summaryKo = p.summaryKo as string | undefined;
        if (!summaryKo) return null;
        return (
          <DetailBox kind="muted" title="한국어 요약">
            {summaryKo}
          </DetailBox>
        );
      },
    },
  ],

  /* ── Compare (Edit 비교 + Vision Compare 공용 · 4 stage) — Phase 6 ── */
  compare: [
    { type: "compare-encoding", label: "이미지 A/B 인코딩", subLabel: "browser" },
    {
      // refined_intent — Edit context 의 캐시 미스 + edit_prompt 있을 때만 도착.
      // Vision Compare 메뉴는 이 stage emit 안 함 → enabled 가 false 라 row 안 보임.
      type: "intent-refine",
      label: "수정 의도 정제",
      subLabel: gemmaSubLabel,
      enabled: (c) => c.intentRefineArrived === true,
    },
    {
      type: "vision-pair",
      label: "이미지 비교 분석",
      subLabel: visionSubLabel,
      // Edit/Video 패턴 일관 — overall 점수 + summary_en 박스
      renderDetail: (p) => {
        const summaryEn = p.summaryEn as string | undefined;
        const overall = p.overall as number | undefined;
        const provider = p.provider as string | undefined;
        if (!summaryEn && overall == null) return null;
        const title =
          overall != null
            ? `비교 요약 · 종합 ${overall}% (${provider ?? "?"})`
            : `비교 요약 (${provider ?? "?"})`;
        return (
          <DetailBox
            // Phase 2 (2026-05-01) — fallback / fallback-precise-failed 둘 다 warn 톤
            kind={provider?.startsWith("fallback") ? "warn" : "info"}
            title={title}
          >
            {summaryEn ?? "—"}
          </DetailBox>
        );
      },
    },
    {
      type: "translation",
      label: "한국어 번역",
      subLabel: "gemma4-un",
      enabled: (c) => !c.gemma4Off,
      renderDetail: (p) => {
        const summaryKo = p.summaryKo as string | undefined;
        if (!summaryKo) return null;
        return (
          <DetailBox kind="muted" title="한국어 요약">
            {summaryKo}
          </DetailBox>
        );
      },
    },
  ],
};
