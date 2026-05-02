/**
 * Vision Analyzer Page — 단일 이미지 분석 보조 기능.
 * 2026-04-24 · C5.
 *
 * 레이아웃: 좌 400px (업로드 + [분석] 버튼) / 우 1fr (결과 카드 + 최근 분석 그리드).
 * 생성/수정 페이지와 동일한 Chrome + sticky CTA 스타일 유지.
 */

"use client";

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
        {/* ── LEFT: 업로드 + CTA (Phase 1.5.6 · V5) ── */}
        <StudioLeftPanel>
          <StudioModeHeader
            titleKo="분석"
            titleEn="Analyze"
            eyebrow="MODE · ANALYZE"
            description="이미지 한 장의 구도, 분위기, 품질을 분석하고 번역합니다."
          />

          {/* Phase 1.5.6 (결정 H · 2026-05-02) — CTA 상단 sticky 로 변경.
           *  옛: 패널 하단 sticky + flex:1 spacer + onMouseEnter inline style swap.
           *  신: StudioModeHeader 직후 .ais-cta-sticky-top + .ais-cta-primary (Aurora Glass).
           *  inline style 잔여 0 (V5 시각 대상). */}
          <div className="ais-cta-sticky-top">
            <button
              type="button"
              onClick={analyze}
              disabled={analyzeDisabled}
              className="ais-cta-primary"
            >
              {analyzing ? (
                <>
                  <Spinner /> 분석 중…
                </>
              ) : (
                <>
                  <Icon name="search" size={15} />
                  Analyze
                </>
              )}
            </button>
            <div className="ais-cta-eta">
              평균 소요 <span className="mono">~8s</span> · 로컬 처리 · 데이터
              전송 없음
            </div>
          </div>

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

          {/* 안내 배너 — 이 기능의 성격 (옛 그대로 유지). */}
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
        </StudioLeftPanel>

        {/* ── RIGHT: 결과 카드 + 히스토리 (V5 Phase 6) ── */}
        <StudioRightPanel>
          <StudioResultHeader
            title="분석 결과"
            titleEn="Analysis"
            meta={
              currentWidth && currentHeight ? (
                <>
                  <span className="ais-result-pill ais-pill-violet mono">
                    {currentWidth} × {currentHeight}
                  </span>
                  <span className="ais-result-pill mono">EN + KO</span>
                </>
              ) : (
                <span className="ais-result-pill mono">EN + KO</span>
              )
            }
          />

          <VisionResultCard result={lastResult} running={analyzing} />

          <VisionHistoryList
            entries={entries}
            onSelect={loadEntry}
            onDelete={removeEntry}
            onClear={clearEntries}
            maxEntries={MAX_VISION_HISTORY}
          />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}
