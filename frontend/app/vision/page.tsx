/**
 * Vision Analyzer Page — 단일 이미지 분석 보조 기능.
 * 2026-04-24 · C5.
 *
 * 레이아웃: 좌 400px (업로드 + [분석] 버튼) / 우 1fr (결과 카드 + 최근 분석 그리드).
 * 생성/수정 페이지와 동일한 Chrome + sticky CTA 스타일 유지.
 */

"use client";

import { useState } from "react";
import AppHeader from "@/components/chrome/AppHeader";
import ProgressModal from "@/components/studio/ProgressModal";
import SourceImageCard from "@/components/studio/SourceImageCard";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import {
  StudioLeftPanel,
  StudioModeHeader,
  StudioPage,
  StudioRightPanel,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import VisionHistoryList from "@/components/studio/VisionHistoryList";
import VisionResultCard from "@/components/studio/VisionResultCard";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";
import { useVisionPipeline } from "@/hooks/useVisionPipeline";
import { useAutoCloseModal } from "@/hooks/useAutoCloseModal";
import { toast } from "@/stores/useToastStore";
import { MAX_VISION_HISTORY, useVisionStore } from "@/stores/useVisionStore";

export default function VisionPage() {
  /* ── store ── */
  const currentImage = useVisionStore((s) => s.currentImage);
  const currentLabel = useVisionStore((s) => s.currentLabel);
  const currentWidth = useVisionStore((s) => s.currentWidth);
  const currentHeight = useVisionStore((s) => s.currentHeight);
  const setSource = useVisionStore((s) => s.setSource);
  const clearSource = useVisionStore((s) => s.clearSource);
  const lastResult = useVisionStore((s) => s.lastResult);
  const entries = useVisionStore((s) => s.entries);
  const removeEntry = useVisionStore((s) => s.removeEntry);
  const clearEntries = useVisionStore((s) => s.clearEntries);
  const loadEntry = useVisionStore((s) => s.loadEntry);


  /* ── 갤러리 컬럼 토글 (2/3/4) — Generate/Edit 와 동일 ── */
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /* ── 파이프라인 훅 ── */
  const { analyze, analyzing } = useVisionPipeline();

  /* ── 진행 모달 open 상태 — useAutoCloseModal hook (1000ms · 분석은 짧음) ── */
  const [progressOpen, setProgressOpen] = useAutoCloseModal(analyzing, 1000);

  /* ── 소스 이미지 핸들러 ── */
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
    clearSource();
    toast.info("이미지 해제됨");
  };

  const analyzeDisabled = analyzing || !currentImage;

  return (
    <StudioPage>
      {progressOpen && (
        <ProgressModal mode="vision" onClose={() => setProgressOpen(false)} />
      )}
      <AppHeader />

      <StudioWorkspace>
        {/* ── LEFT: 업로드 + CTA ── */}
        <StudioLeftPanel>
          <StudioModeHeader
            title="Vision Analyze"
            description="이미지 한 장의 구도, 분위기, 품질을 분석하고 번역합니다."
          />
          <div>
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
                원본 이미지
              </label>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: "var(--ink-4)" }}
              >
                {currentWidth && currentHeight
                  ? `${currentWidth}×${currentHeight}`
                  : "—"}
              </span>
            </div>

            <SourceImageCard
              sourceImage={currentImage}
              sourceLabel={currentLabel}
              sourceWidth={currentWidth}
              sourceHeight={currentHeight}
              onChange={handleSourceChange}
              onClear={handleClearSource}
              onError={(msg) => toast.error(msg)}
            />
          </div>

          {/* 안내 배너 — 이 기능의 성격 */}
          <div
            style={{
              padding: "12px 14px",
              background: "var(--bg-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.55,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
                color: "var(--ink-2)",
                fontWeight: 600,
              }}
            >
              <Icon name="search" size={13} />
              이미지 → 프롬프트 엔지니어 어조 설명
            </div>
            <div>
              40~120 단어 영문 + 한글 번역으로 추출합니다. 결과를 복사해
              <b>생성</b> 페이지 프롬프트에 그대로 붙여 넣어 사용하실 수 있습니다.
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
              onClick={analyze}
              disabled={analyzeDisabled}
              style={{
                all: "unset",
                cursor: analyzeDisabled ? "not-allowed" : "pointer",
                textAlign: "center",
                background: analyzeDisabled ? "var(--accent-disabled)" : "var(--accent)",
                color: "#fff",
                padding: "14px 20px",
                borderRadius: "var(--radius-full)",
                fontSize: 14,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                boxSizing: "border-box",
                boxShadow: analyzing
                  ? "none"
                  : "0 4px 18px rgba(74,158,255,.42), inset 0 1px 0 rgba(255,255,255,.2)",
                transition: "all .18s",
              }}
              onMouseEnter={(e) => {
                if (!analyzeDisabled)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--accent-ink)";
              }}
              onMouseLeave={(e) => {
                if (!analyzeDisabled)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--accent)";
              }}
            >
              {analyzing ? (
                <>
                  <Spinner /> 분석 중…
                </>
              ) : (
                <>
                  <Icon name="search" size={15} />
                  분석
                </>
              )}
            </button>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textAlign: "center",
                marginTop: 6,
              }}
            >
              평균 소요 <span className="mono">~8s</span> · 로컬 처리 · 데이터
              전송 없음
            </div>
          </div>
        </StudioLeftPanel>

        {/* ── RIGHT: 결과 카드 + 히스토리 ── */}
        <StudioRightPanel>
          {/* audit R2-9: 공통 StudioResultHeader 로 교체 */}
          <StudioResultHeader title="분석 결과" meta="EN + KO" />

          <VisionResultCard result={lastResult} running={analyzing} />

          <VisionHistoryList
            entries={entries}
            onSelect={loadEntry}
            onDelete={removeEntry}
            onClear={clearEntries}
            gridCols={gridCols}
            onCycleGrid={cycleGrid}
            maxEntries={MAX_VISION_HISTORY}
          />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}
