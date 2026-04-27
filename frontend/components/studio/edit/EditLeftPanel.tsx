/**
 * EditLeftPanel — Edit 페이지 좌측 입력 패널.
 *
 * 포함:
 *  - StudioModeHeader (Image Edit)
 *  - 원본 이미지 카드 (HistoryPicker 토글 + SourceImageCard)
 *  - 수정 지시 textarea (PromptHistoryPeek + 비우기 버튼)
 *  - Lightning Toggle
 *  - Primary CTA (sticky · 처리 중 spinner)
 *
 * 2026-04-26: edit/page.tsx 646줄 → 분해 step 1.
 *  - Store 직접 구독 (useEditInputs) → page.tsx 의 prop drilling 차단
 *  - 인라인 style 다수 → globals.css `.ais-*` 토큰 클래스 (Generate 와 통일)
 *
 * Page 가 prop 으로 넘기는 것: promptTextareaRef + onGenerate 두 개.
 * (HistoryPicker open/close 상태는 컴포넌트 내부 — page 분리 보존)
 */

"use client";

import type { RefObject } from "react";
import { useState } from "react";
import HistoryPicker from "@/components/studio/HistoryPicker";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import SourceImageCard from "@/components/studio/SourceImageCard";
import {
  StudioLeftPanel,
  StudioModeHeader,
} from "@/components/studio/StudioLayout";
import Icon from "@/components/ui/Icon";
import { Spinner, Toggle } from "@/components/ui/primitives";
import { useEditInputs, useEditRunning } from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";

interface Props {
  /** prompt textarea ref — useAutoGrowTextarea 훅이 부모에서 관리 */
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 수정 생성 트리거 (useEditPipeline.generate) */
  onGenerate: () => void;
}

export default function EditLeftPanel({
  promptTextareaRef,
  onGenerate,
}: Props) {
  const {
    sourceImage, sourceLabel, sourceWidth, sourceHeight, setSource,
    prompt, setPrompt,
    lightning, setLightning,
  } = useEditInputs();
  const { running } = useEditRunning();
  const items = useHistoryStore((s) => s.items);

  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);

  const handleSourceChange = (
    image: string,
    label: string,
    w: number,
    h: number,
  ) => {
    setSource(image, label, w, h);
    toast.success("이미지 업로드 완료", label.split(" · ")[0]);
  };

  const handleClearSource = () => {
    setSource(null);
    toast.info("이미지 해제됨");
  };

  const ctaDisabled = running || !sourceImage || !prompt.trim();

  return (
    <StudioLeftPanel>
      <StudioModeHeader
        title="Image Edit"
        description="원본 이미지와 수정 지시로 새로운 결과 이미지를 만듭니다."
      />

      {/* Primary CTA — sticky 상단 (Generate 와 통일 · 폼 길어져도 시야 안) */}
      <div className="ais-cta-sticky-top">
        <button
          type="button"
          onClick={onGenerate}
          disabled={ctaDisabled}
          className="ais-cta-primary"
        >
          {running ? (
            <>
              <Spinner /> 처리 중…
            </>
          ) : (
            <>
              <Icon name="wand" size={16} />
              수정 생성
            </>
          )}
        </button>
      </div>

      {/* ── 원본 이미지 ── */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            원본 이미지
          </label>
          <button
            type="button"
            onClick={() => setHistoryPickerOpen((v) => !v)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              color: historyPickerOpen ? "var(--accent-ink)" : "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="grid" size={11} /> 히스토리에서 선택
          </button>
        </div>

        {/* History picker overlay — video 항목은 Edit 의 원본으로 부적절 → 제외 */}
        <HistoryPicker
          open={historyPickerOpen}
          items={items.filter((i) => i.mode !== "video")}
          onSelect={(it) => {
            setSource(
              it.imageRef,
              `${it.label} · ${it.width}×${it.height}`,
              it.width,
              it.height,
            );
            setHistoryPickerOpen(false);
            toast.info("원본으로 지정", it.label);
          }}
        />

        <SourceImageCard
          sourceImage={sourceImage}
          sourceLabel={sourceLabel}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={handleSourceChange}
          onClear={handleClearSource}
          onError={(msg) => toast.error(msg)}
        />
      </div>

      {/* ── 수정 지시 prompt ── */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            수정 지시
          </label>
          <span className="mono ais-field-meta">{prompt.length} chars</span>
        </div>
        <div className="ais-prompt-shell">
          <PromptHistoryPeek mode="edit" onSelect={(p) => setPrompt(p)} />
          <textarea
            ref={promptTextareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="어떻게 수정할까요? 예: 배경을 바다로 바꿔주세요"
            rows={3}
            className="ais-prompt-textarea"
          />
          {prompt.length > 0 && (
            <button
              type="button"
              onClick={() => setPrompt("")}
              title="프롬프트 비우기"
              className="ais-prompt-clear"
              style={{ position: "absolute", bottom: 6, right: 10 }}
            >
              <Icon name="x" size={10} /> 비우기
            </button>
          )}
        </div>
      </div>

      {/* ── 고퀄 모드 토글 (Generate 와 통일 · 우측 토글 · 의미 반전) ──
       *  OFF=Lightning 빠름 (기본) / ON=💎 고퀄 모드 (강화 옵션)
       *  store 의 lightning 의미는 그대로 (true=LoRA ON=빠름) — UI 만 반전 (`!lightning`).
       */}
      <Toggle
        checked={!lightning}
        onChange={(v) => setLightning(!v)}
        align="right"
        label="💎 고퀄 모드"
        desc={
          lightning
            ? "Lightning 4-step · 빠름 · 약간 낮은 디테일 (기본)"
            : "Lightning OFF · 풀 퀄리티 · 약 ~38s 예상"
        }
      />
    </StudioLeftPanel>
  );
}
