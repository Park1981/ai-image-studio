/**
 * CompareLeftPanel — /vision/compare 좌 패널 (입력).
 * 2026-04-27 (C2-P1-1): vision/compare/page.tsx 분해 — 페이지에서 추출.
 *
 * 구성:
 *   - StudioModeHeader (제목 + 설명)
 *   - 이미지 A 슬롯 + A↔B 스왑 버튼 + 이미지 B 슬롯
 *   - 비교 지시 textarea (선택 · PromptHistoryPeek 통합)
 *   - Sticky CTA (분석 시작)
 *
 * 페이지 → 패널 의존성: imageA/imageB/hint/running 상태 + setter +
 *   onAnalyze 콜백 (페이지가 보유). 패널은 store 직접 호출 안 함.
 */

"use client";

import { useState } from "react";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { CompareImageSlot } from "@/components/studio/CompareImageSlot";
import ImageHistoryPickerDrawer from "@/components/studio/ImageHistoryPickerDrawer";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import ProcessingCTA from "@/components/studio/ProcessingCTA";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import { StudioModeHeader } from "@/components/studio/StudioLayout";
import VisionModelSelector, {
  VISION_MODEL_OPTIONS,
} from "@/components/studio/VisionModelSelector";
import Icon from "@/components/ui/Icon";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import {
  useVisionCompareStore,
  type VisionCompareImage,
} from "@/stores/useVisionCompareStore";

type CompareHistoryTarget = "A" | "B";

interface Props {
  imageA: VisionCompareImage | null;
  imageB: VisionCompareImage | null;
  hint: string;
  running: boolean;
  canRun: boolean;
  setImageA: (img: VisionCompareImage | null) => void;
  setImageB: (img: VisionCompareImage | null) => void;
  swapImages: () => void;
  setHint: (h: string) => void;
  onAnalyze: () => void;
}

export default function CompareLeftPanel({
  imageA,
  imageB,
  hint,
  running,
  canRun,
  setImageA,
  setImageB,
  swapImages,
  setHint,
  onAnalyze,
}: Props) {
  const hintTextareaRef = useAutoGrowTextarea(hint);
  const [historyTarget, setHistoryTarget] = useState<CompareHistoryTarget | null>(null);
  const imageHistoryItems = useHistoryStore((s) => s.items);
  const latestStageProgress = useVisionCompareStore((s) =>
    s.stageHistory.length > 0
      ? s.stageHistory[s.stageHistory.length - 1].progress
      : 0,
  );
  const latestStageLabel = useVisionCompareStore((s) =>
    s.stageHistory.length > 0
      ? s.stageHistory[s.stageHistory.length - 1].label
      : "",
  );
  // V4 Phase 8: 비전 모델 카드 — vision/compare 공용 (settings persist 공유)
  const visionModel = useSettingsStore((s) => s.visionModel);
  const setVisionModel = useSettingsStore((s) => s.setVisionModel);

  const activeImage = historyTarget === "A" ? imageA : historyTarget === "B" ? imageB : null;
  const drawerTitle =
    historyTarget === "B" ? "이미지 B 선택" : "이미지 A 선택";

  const pickHistoryImage = (target: CompareHistoryTarget) => {
    setHistoryTarget(target);
  };

  return (
    <>
      <StudioModeHeader
        titleKo="비교"
        titleEn="Compare"
        eyebrow="MODE · COMPARE"
        description="두 이미지의 차이를 관찰자 듀얼 + 차이 합성으로 자세히 분석합니다."
      />

      {/* Phase 1.5.5 (결정 F · 2026-05-02) — CTA 상단 sticky.
       *  StudioModeHeader 직후 공통 ProcessingCTA 사용.
       *  inline style 잔여 0 (V5 시각 대상). */}
      <div className="ais-cta-sticky-top">
        <ProcessingCTA
          onClick={onAnalyze}
          disabled={!canRun}
          running={running}
          progress={latestStageProgress}
          idleLabel="Compare"
          runningLabel="비교 분석 중"
          subLabel={latestStageLabel || "COMPARE ANALYSIS"}
          icon="compare"
        />
      </div>

      {/* 이미지 A 슬롯 */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            이미지 A
          </label>
          <ImageHistoryButton onClick={() => pickHistoryImage("A")} />
        </div>
        <CompareImageSlot
          label="이미지 A"
          badge="A"
          value={imageA}
          onChange={setImageA}
          onClear={() => setImageA(null)}
        />
      </div>

      {/* A↔B 스왑 버튼 — 두 슬롯 사이 */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button
          type="button"
          onClick={swapImages}
          disabled={!imageA && !imageB}
          title="A 와 B 자리 바꾸기"
          style={{
            all: "unset",
            cursor: !imageA && !imageB ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            background: "var(--bg-2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-full)",
            fontSize: 12,
            color: "var(--ink-2)",
            opacity: !imageA && !imageB ? 0.4 : 1,
          }}
        >
          <Icon name="refresh" size={12} />
          A ↔ B 자리 바꾸기
        </button>
      </div>

      {/* 이미지 B 슬롯 */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            이미지 B
          </label>
          <ImageHistoryButton onClick={() => pickHistoryImage("B")} />
        </div>
        <CompareImageSlot
          label="이미지 B"
          badge="B"
          value={imageB}
          onChange={setImageB}
          onClear={() => setImageB(null)}
        />
      </div>

      <ImageHistoryPickerDrawer
        open={historyTarget !== null}
        items={imageHistoryItems}
        selectedImageRef={activeImage?.dataUrl ?? null}
        title={drawerTitle}
        description="생성/수정 히스토리에서 비교할 이미지를 고릅니다."
        onClose={() => setHistoryTarget(null)}
        onPick={(it) => {
          const next: VisionCompareImage = {
            dataUrl: it.imageRef,
            label: `${it.label} · ${it.width}×${it.height}`,
            width: it.width,
            height: it.height,
          };
          if (historyTarget === "A") setImageA(next);
          if (historyTarget === "B") setImageB(next);
          toast.info(`${historyTarget ?? "이미지"} 지정`, it.label);
        }}
      />

      {/* Vision 모델 카드 (V4 Phase 8 추가 · vision 페이지와 공용) */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="violet" />
            Vision 모델
          </label>
          <span className="mono ais-field-meta">
            {VISION_MODEL_OPTIONS.find((o) => o.id === visionModel)?.label ??
              visionModel}
          </span>
        </div>
        <VisionModelSelector
          value={visionModel}
          onChange={setVisionModel}
          disabled={running}
        />
      </div>

      {/* 비교 지시 (선택) */}
      <div style={{ marginTop: 6 }}>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            비교 지시{" "}
            <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>(선택)</span>
          </label>
        </div>
        <div className="ais-prompt-shell">
          <PromptHistoryPeek mode="compare" onSelect={(p) => setHint(p)} />
          <textarea
            ref={hintTextareaRef}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="예: 의상 차이에 집중해 주세요 / 색감 변화 위주로 비교"
            rows={3}
            className="ais-prompt-textarea"
          />
          {hint.length > 0 && (
            <button
              type="button"
              onClick={() => setHint("")}
              aria-label="비교 지시 비우기"
              title="비교 지시 비우기"
              className="ais-prompt-clear-icon"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function ImageHistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: "unset",
        cursor: "pointer",
        fontSize: 11,
        color: "var(--ink-3)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name="grid" size={11} /> 이미지 히스토리
    </button>
  );
}
