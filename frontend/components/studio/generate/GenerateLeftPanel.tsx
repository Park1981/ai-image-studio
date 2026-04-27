/**
 * GenerateLeftPanel — Generate 페이지 좌측 입력 패널.
 *
 * 포함:
 *  - StudioModeHeader (mode 타이틀)
 *  - 프롬프트 카드 (textarea + 템플릿 저장 + 비우기)
 *  - PromptHistoryPeek (스프링 메뉴)
 *  - ResearchBanner (Claude 조사 인라인)
 *  - Lightning Toggle
 *  - SizeCard (W/H + 비율잠금)
 *  - Primary CTA (sticky · 진행 progress 바)
 *
 * 2026-04-26 (task #5): generate/page.tsx 1,800+ 줄 분해 step 2.
 *  Store 직접 구독 (useGenerateInputs/useGenerateRunning) → page.tsx 의 prop drilling 차단.
 *
 * 2026-04-27 (UX 폴리시): Primary CTA 가 패널 하단 → 상단으로 이동 (오빠 피드백).
 *  StudioModeHeader 직후 배치, sticky top:64px → 폼 길어져도 항상 시야 안.
 */

"use client";

import type { RefObject } from "react";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import ResearchBanner from "@/components/studio/ResearchBanner";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import {
  StudioLeftPanel,
  StudioModeHeader,
} from "@/components/studio/StudioLayout";
import Icon from "@/components/ui/Icon";
import { Spinner, Toggle } from "@/components/ui/primitives";
import {
  useGenerateInputs,
  useGenerateRunning,
} from "@/stores/useGenerateStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import SizeCard from "./SizeCard";

interface Props {
  /** prompt textarea ref — useAutoGrowTextarea 훅이 부모에서 관리 */
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 생성 트리거 (useGeneratePipeline.generate) */
  onGenerate: () => void;
  /** Claude 조사 미리받기 상태 (useGeneratePipeline.researchPreview).
   *  hints null 은 "아직 미리받기 안 함" / [] 은 "받았으나 결과 0건" 의미. */
  researchPreview: {
    loading: boolean;
    hints: string[] | null;
    error: string | null;
    run: () => void | Promise<void>;
  };
}

export default function GenerateLeftPanel({
  promptTextareaRef,
  onGenerate,
  researchPreview,
}: Props) {
  const {
    prompt, setPrompt,
    aspect, setAspect,
    width, height, setWidth, setHeight,
    aspectLocked, setAspectLocked,
    research, setResearch,
    lightning, applyLightning,
  } = useGenerateInputs();
  const { generating, progress, stage } = useGenerateRunning();
  const addTemplate = useSettingsStore((s) => s.addTemplate);

  const sizeLabel = `${width}×${height}`;

  return (
    <StudioLeftPanel>
      <StudioModeHeader
        title="Image Generate"
        description="프롬프트를 다듬고 로컬 ComfyUI로 이미지를 생성합니다."
      />

      {/* Primary CTA — sticky 상단 (폼 길어지면 따라옴 · generate 전용 클래스) */}
      <div className="ais-cta-sticky-top">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating || !prompt.trim()}
          className="ais-cta-primary"
        >
          {generating ? (
            <>
              <div
                className="ais-cta-progress"
                style={{ width: `${progress}%` }}
              />
              <span className="ais-cta-content">
                <Spinner />
                {stage} · {Math.round(progress)}%
              </span>
            </>
          ) : (
            <>
              <Icon name="sparkle" size={15} />
              생성
              <span className="mono ais-cta-shortcut">⇧↵</span>
            </>
          )}
        </button>

        <div className="ais-cta-eta">
          평균 소요{" "}
          <span className="mono">~{research ? "42" : "28"}s</span> · 로컬
          처리 · 데이터 전송 없음
        </div>
      </div>

      {/* ── 프롬프트 카드 ── */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            프롬프트
          </label>
          <span className="mono ais-field-meta">
            {prompt.length} chars · KO
          </span>
        </div>
        <div className="ais-prompt-shell">
          <PromptHistoryPeek mode="generate" onSelect={(p) => setPrompt(p)} />
          <textarea
            ref={promptTextareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="자연어로 자유롭게 입력. 예: 책 읽는 고양이, 창가, 늦은 오후..."
            rows={3}
            className="ais-prompt-textarea"
          />
          <div className="ais-prompt-footer">
            <div />
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  if (!prompt.trim()) {
                    toast.warn("저장할 프롬프트가 없습니다.");
                    return;
                  }
                  const name =
                    typeof window !== "undefined"
                      ? window.prompt("템플릿 이름?", prompt.slice(0, 20))
                      : null;
                  if (!name) return;
                  addTemplate({ name: name.trim(), text: prompt });
                  toast.success(
                    "템플릿 저장됨",
                    "⚙️ 설정 > 프롬프트 템플릿에서 불러오기",
                  );
                }}
                className="ais-prompt-link"
                title="현재 프롬프트를 템플릿으로 저장"
              >
                <Icon name="sparkle" size={11} /> 템플릿 저장
              </button>
              <button
                type="button"
                onClick={() => setPrompt("")}
                title="프롬프트 비우기"
                className="ais-prompt-clear"
              >
                <Icon name="x" size={10} /> 비우기
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Claude 조사 배너 */}
      <ResearchBanner
        checked={research}
        onChange={setResearch}
        onPreview={researchPreview.run}
        loading={researchPreview.loading}
        hints={researchPreview.hints}
        error={researchPreview.error}
      />

      {/* Lightning toggle */}
      <Toggle
        checked={lightning}
        onChange={applyLightning}
        label={lightning ? "⚡ Lightning 4-step" : "표준 (고퀄)"}
        desc={
          lightning
            ? "Lightning LoRA ON · 약 4배 빠름"
            : "Lightning LoRA OFF · 풀 퀄리티"
        }
      />

      {/* 사이즈 카드 */}
      <SizeCard
        aspect={aspect}
        sizeLabel={sizeLabel}
        width={width}
        height={height}
        aspectLocked={aspectLocked}
        onAspect={(v) => setAspect(v)}
        onWidth={setWidth}
        onHeight={setHeight}
        onAspectLocked={setAspectLocked}
      />
    </StudioLeftPanel>
  );
}
