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

import {
  CompareImageSlot,
} from "@/components/studio/CompareImageSlot";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import { StudioModeHeader } from "@/components/studio/StudioLayout";
import Icon from "@/components/ui/Icon";
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
  return (
    <>
      <StudioModeHeader
        title="Vision Compare"
        description="두 이미지의 차이와 품질을 5축 기준으로 비교합니다."
      />

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

      {/* 비교 지시 (선택) */}
      <div style={{ marginTop: 6 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <label
            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}
          >
            비교 지시{" "}
            <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>(선택)</span>
          </label>
          <span
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-4)" }}
          >
            {hint.length} chars
          </span>
        </div>
        <div
          style={{
            position: "relative",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <PromptHistoryPeek mode="compare" onSelect={(p) => setHint(p)} />
          <textarea
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="예: 의상 차이에 집중해 주세요 / 색감 변화 위주로 비교"
            rows={3}
            style={{
              display: "block",
              width: "100%",
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              padding: "12px 42px 30px 14px",
              fontFamily: "inherit",
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "var(--ink)",
              borderRadius: "var(--radius)",
              minHeight: 76,
            }}
          />
          {hint.length > 0 && (
            <button
              type="button"
              onClick={() => setHint("")}
              title="비교 지시 비우기"
              style={{
                all: "unset",
                cursor: "pointer",
                position: "absolute",
                bottom: 6,
                right: 10,
                fontSize: 11,
                color: "var(--ink-4)",
                display: "flex",
                alignItems: "center",
                gap: 3,
                padding: "4px 6px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <Icon name="x" size={10} /> 비우기
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* Sticky CTA */}
      <div
        style={{
          position: "sticky",
          bottom: 12,
          paddingTop: 10,
          zIndex: 4,
          background:
            "linear-gradient(to bottom, transparent, var(--bg) 45%)",
        }}
      >
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canRun}
          style={{
            all: "unset",
            cursor: canRun ? "pointer" : "not-allowed",
            textAlign: "center",
            background: canRun ? "var(--accent)" : "var(--accent-disabled)",
            color: "#fff",
            padding: "14px 20px",
            borderRadius: "var(--radius-full)",
            fontSize: 14,
            fontWeight: 600,
            width: "100%",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {running ? (
            <>
              <Icon name="refresh" size={14} className="spin" />
              분석 중…
            </>
          ) : (
            <>
              <Icon name="sparkle" size={14} />
              비교 분석 시작
            </>
          )}
        </button>
      </div>
    </>
  );
}
