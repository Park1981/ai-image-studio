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

import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import { CompareImageSlot } from "@/components/studio/CompareImageSlot";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import { StudioModeHeader } from "@/components/studio/StudioLayout";
import VisionModelSelector, {
  VISION_MODEL_OPTIONS,
} from "@/components/studio/VisionModelSelector";
import Icon from "@/components/ui/Icon";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { VisionCompareImage } from "@/stores/useVisionCompareStore";

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
  // V4 Phase 8: 비전 모델 카드 — vision/compare 공용 (settings persist 공유)
  const visionModel = useSettingsStore((s) => s.visionModel);
  const setVisionModel = useSettingsStore((s) => s.setVisionModel);

  return (
    <>
      <StudioModeHeader
        titleKo="비교"
        titleEn="Compare"
        eyebrow="MODE · COMPARE"
        description="두 이미지의 차이를 관찰자 듀얼 + 차이 합성으로 자세히 분석합니다."
      />

      {/* Phase 1.5.5 (결정 F · 2026-05-02) — CTA 상단 sticky 로 변경.
       *  옛: 패널 하단 sticky + flex:1 spacer 로 밀어내림.
       *  신: StudioModeHeader 직후 .ais-cta-sticky-top (Generate/Edit/Video 와 통일).
       *  inline style 잔여 0 (V5 시각 대상) — Aurora Glass CTA 자동 적용. */}
      <div className="ais-cta-sticky-top">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canRun}
          className="ais-cta-primary"
        >
          {running ? (
            <>
              <Icon name="refresh" size={14} className="spin" />
              분석 중…
            </>
          ) : (
            <>
              <Icon name="sparkle" size={14} />
              Compare
            </>
          )}
        </button>
      </div>

      {/* 이미지 A 슬롯 */}
      <CompareImageSlot
        label="이미지 A"
        badge="A"
        value={imageA}
        onChange={setImageA}
        onClear={() => setImageA(null)}
      />

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
      <CompareImageSlot
        label="이미지 B"
        badge="B"
        value={imageB}
        onChange={setImageB}
        onClear={() => setImageB(null)}
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
