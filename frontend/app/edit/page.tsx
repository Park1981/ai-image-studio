/**
 * Edit Mode Page — Zustand + Mock API + FileReader 업로드.
 *  - sourceImage 는 useEditStore (세션 한정)
 *  - 완료 시 useHistoryStore 에 추가
 *  - 우측 Before/After 슬라이더 비교
 *  - 히스토리에서 선택: 오버레이 팝업 (최근 이미지 12개에서 source 로 지정)
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { IconBtn } from "@/components/chrome/Chrome";
import AppHeader from "@/components/chrome/AppHeader";
import BeforeAfterSlider from "@/components/studio/BeforeAfterSlider";
import ComparisonAnalysisCard from "@/components/studio/ComparisonAnalysisCard";
import ComparisonAnalysisModal from "@/components/studio/ComparisonAnalysisModal";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
import { useAutoCloseModal } from "@/hooks/useAutoCloseModal";
import { useAutoGrowTextarea } from "@/hooks/useAutoGrowTextarea";
import HistoryGallery from "@/components/studio/HistoryGallery";
import HistoryPicker from "@/components/studio/HistoryPicker";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import ImageLightbox from "@/components/studio/ImageLightbox";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";
import ProgressModal from "@/components/studio/ProgressModal";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import SourceImageCard from "@/components/studio/SourceImageCard";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import {
  StudioLeftPanel,
  StudioModeHeader,
  StudioPage,
  StudioRightPanel,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import Icon from "@/components/ui/Icon";
import { Spinner, Toggle } from "@/components/ui/primitives";
import { downloadImage, filenameFromRef } from "@/lib/image-actions";
import { useEditPipeline } from "@/hooks/useEditPipeline";
import {
  useEditStore,
  useEditInputs,
  useEditRunning,
} from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

export default function EditPage() {
  /* ── store (그룹 selectors · task #8 · 11줄 → 2줄) ── */
  const {
    sourceImage, sourceLabel, sourceWidth, sourceHeight, setSource,
    prompt, setPrompt,
    lightning, setLightning,
  } = useEditInputs();
  const { running } = useEditRunning();
  const compareX = useEditStore((s) => s.compareX);
  const setCompareX = useEditStore((s) => s.setCompareX);

  const lightningByDefault = useSettingsStore((s) => s.lightningByDefault);

  const items = useHistoryStore((s) => s.items);
  // history.add 는 useEditPipeline 내부에서 호출됨 (여기 직접 사용 안 함)
  const selectHistory = useHistoryStore((s) => s.select);

  const { analyze, isBusy } = useComparisonAnalysis();
  const [comparisonModalOpen, setComparisonModalOpen] = useState(false);

  // 수정 모드 우측 그리드는 edit 결과만 (generate 섞이면 Before/After 슬라이더가 엉뚱하게 매칭됨)
  // 2026-04-24 G2: 갤러리화 — 전체 렌더 + 스크롤 박스로 제한 대신 스크롤 UX 로 전환
  const editResults = items.filter((x) => x.mode === "edit");
  // afterId 는 기본 null. 새 수정이 완료되면 setAfterId 로 지정됨.
  // 히스토리 썸네일 클릭 시에도 사용자 의도대로 지정됨.
  const [afterId, setAfterId] = useState<string | null>(null);
  const afterItem = afterId
    ? editResults.find((x) => x.id === afterId)
    : undefined;

  /* ── 파이프라인 훅 — 새 결과 완료 시 afterId 지정 ── */
  const pipeline = useEditPipeline({
    onComplete: (id) => setAfterId(id),
  });
  const handleGenerate = pipeline.generate;

  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);

  /* ── 소스 이미지 해제 (SourceImageCard 의 × 와 팝오버 링크 공통 경로) ── */
  const handleClearSource = () => {
    setSource(null);
    toast.info("이미지 해제됨");
  };

  /* ── Lightbox ── */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // 수정 히스토리 갤러리 컬럼 토글 — Generate/Vision 과 동일 패턴
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /* ── 결과 뷰어 호버 상태 (호버 시 액션바 페이드 인) ── */
  const [viewerHovered, setViewerHovered] = useState(false);

  /* ── 진행 모달 open 상태 — useAutoCloseModal hook (task #5/#7) ── */
  const [progressOpen, setProgressOpen] = useAutoCloseModal(running);

  /* ── 매칭 안 되는 afterId 정리 (시각 selection 일관성) ──
     슬라이더 자체는 afterItem.sourceRef === sourceImage 조건으로 자동 빈 상태 처리되지만,
     히스토리 타일의 selected 표시도 같이 정리해주면 사용자 혼란 감소.
     Zustand setter 는 외부 구독자도 리렌더시키므로 useEffect 로 지연 호출
     (렌더 중 호출 시 React 19 가 "다른 컴포넌트 setState" 경고). */
  useEffect(() => {
    if (afterItem && afterItem.sourceRef !== sourceImage) {
      setAfterId(null);
    }
  }, [sourceImage, afterItem, setAfterId]);

  /* ── afterId 전환 시 비교 슬라이더를 중앙(50) 으로 리셋 ──
     compareX 는 store state 라 세션 내 드래그 값이 유지되는데, 새 비교는 항상
     중앙에서 시작하는 게 자연스러움. compareX 는 의존성에서 제외 —
     포함 시 50 리셋 직후 다시 트리거되는 불필요 루프 발생. */
  useEffect(() => {
    if (afterId) setCompareX(50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afterId]);

  /* ── 진입 시 Lightning 기본값 ── */
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (lightningByDefault && !lightning) setLightning(true);
  }, [lightningByDefault, lightning, setLightning]);

  /* ── 진입 시 수정 지시는 빈 입력으로 시작 ── */
  const promptClearedRef = useRef(false);
  useEffect(() => {
    if (promptClearedRef.current) return;
    promptClearedRef.current = true;
    setPrompt("");
  }, [setPrompt]);

  /* ── 프롬프트 textarea auto-grow — useAutoGrowTextarea hook (task #5/#7) ── */
  const promptTextareaRef = useAutoGrowTextarea(prompt);

  /* ── 파일 업로드 결과 수신 (SourceImageCard 에서 호출) ── */
  const handleSourceChange = (
    image: string,
    label: string,
    w: number,
    h: number,
  ) => {
    setSource(image, label, w, h);
    toast.success("이미지 업로드 완료", label.split(" · ")[0]);
  };

  return (
    <StudioPage>
      {progressOpen && (
        <ProgressModal mode="edit" onClose={() => setProgressOpen(false)} />
      )}
      {comparisonModalOpen && afterItem?.comparisonAnalysis && (
        <ComparisonAnalysisModal
          item={afterItem}
          analysis={afterItem.comparisonAnalysis}
          onClose={() => setComparisonModalOpen(false)}
        />
      )}
      <ImageLightbox
        src={lightboxSrc}
        item={afterItem}
        alt={afterItem?.label}
        filename={
          afterItem
            ? filenameFromRef(
                afterItem.imageRef,
                `ais-edit-${afterItem.id}.png`,
              )
            : undefined
        }
        onClose={() => setLightboxSrc(null)}
        onDownload={() => {
          if (afterItem) {
            downloadImage(
              afterItem.imageRef,
              filenameFromRef(
                afterItem.imageRef,
                `ais-edit-${afterItem.id}.png`,
              ),
            );
          }
        }}
        onUseAsSource={
          afterItem
            ? () => {
                // Lightbox 에서 "원본으로" — 연속 수정 플로우
                setSource(
                  afterItem.imageRef,
                  `${afterItem.label} · ${afterItem.width}×${afterItem.height}`,
                  afterItem.width,
                  afterItem.height,
                );
                setAfterId(null);
                toast.info("원본으로 지정", afterItem.label);
              }
            : undefined
        }
      />
      <AppHeader />

      <StudioWorkspace>
        {/* ── LEFT column ── */}
        <StudioLeftPanel>
          <StudioModeHeader
            title="Image Edit"
            description="원본 이미지와 수정 지시로 새로운 결과 이미지를 만듭니다."
          />
          {/* Dropzone */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
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

            {/* History picker overlay — video 항목은 Edit 의 원본으로 부적절하므로 제외 */}
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

            {/* 컴팩트 이미지 카드 */}
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

          {/* Prompt */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
                수정 지시
              </label>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: "var(--ink-4)" }}
              >
                {prompt.length} chars
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
              {/* 숨김 스프링 프롬프트 히스토리 메뉴 */}
              <PromptHistoryPeek
                mode="edit"
                onSelect={(p) => setPrompt(p)}
              />
              <textarea
                ref={promptTextareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="어떻게 수정할까요? 예: 배경을 바다로 바꿔주세요"
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
                  // auto-grow — 내용 높이 맞춰 확장, 상한 60vh 에서 내부 스크롤
                  minHeight: 76,
                  maxHeight: "60vh",
                  overflowY: "auto",
                }}
              />
              {/* 비우기 버튼 — Generate 페이지와 통일 */}
              {prompt.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPrompt("")}
                  title="프롬프트 비우기"
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
                    transition: "background .12s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "var(--bg-2)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "transparent";
                  }}
                >
                  <Icon name="x" size={10} /> 비우기
                </button>
              )}
            </div>
          </div>

          {/* Lightning toggle (간단 UI) */}
          <Toggle
            checked={lightning}
            onChange={setLightning}
            label={lightning ? "⚡ Lightning 4-step" : "표준 40-step"}
            desc={
              lightning
                ? "빠름 · 약간 낮은 디테일"
                : "풀 퀄리티 · 약 ~38s 예상"
            }
          />

          {/* 2026-04-25: PipelineSteps 좌측 패널 제거 — 진행 모달이 primary */}

          <div style={{ flex: 1 }} />

          {/* CTA — sticky 하단 (페이지 스크롤 시에도 viewport 하단에 고정) */}
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
            onClick={handleGenerate}
            disabled={running || !sourceImage || !prompt.trim()}
            style={{
              all: "unset",
              cursor:
                running || !sourceImage || !prompt.trim()
                  ? "not-allowed"
                  : "pointer",
              textAlign: "center",
              background:
                running || !sourceImage || !prompt.trim()
                  ? "var(--accent-disabled)"
                  : "var(--accent)",
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
              boxShadow: running
                ? "none"
                : "0 4px 18px rgba(74,158,255,.42), inset 0 1px 0 rgba(255,255,255,.2)",
              transition: "all .18s",
            }}
            onMouseEnter={(e) => {
              if (!running && sourceImage && prompt.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--accent-ink)";
            }}
            onMouseLeave={(e) => {
              if (!running && sourceImage && prompt.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--accent)";
            }}
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
        </StudioLeftPanel>

        {/* ── RIGHT column ── */}
        <StudioRightPanel>
          {/* ── 결과 영역 헤더 (audit R2-7: 공통 StudioResultHeader 로 교체) ── */}
          <StudioResultHeader title="수정 결과" meta="BEFORE · AFTER" />

          {/* ── 결과 뷰어 (Before/After 슬라이더 + 호버 액션바) ── */}
          {sourceImage && afterItem && afterItem.sourceRef && afterItem.sourceRef === sourceImage ? (
            <>
              <div
                onMouseEnter={() => setViewerHovered(true)}
                onMouseLeave={() => setViewerHovered(false)}
                style={{
                  // 바깥 wrapper — 섹션 가로 꽉 + BeforeAfter 가운데 정렬.
                  // BeforeAfter 는 aspectRatio + maxHeight 70vh 때문에 세로형 이미지일 땐
                  // width 가 height × ratio 로 축소됨. flex center 로 뷰어 가운데 정렬.
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                {/* 내부 wrapper — BeforeAfter 와 크기가 같아 액션바가 이미지 하단에만 깔림 */}
                <div style={{ position: "relative" }}>
                  <BeforeAfterSlider
                    beforeSrc={sourceImage}
                    afterSeed={afterItem.imageRef || afterItem.id}
                    compareX={compareX}
                    setCompareX={setCompareX}
                    aspectRatio={
                      sourceWidth && sourceHeight
                        ? `${sourceWidth} / ${sourceHeight}`
                        : "16 / 10"
                    }
                  />
                  {/* 호버 액션바 — 이벤트 버블 차단(드래그 핸들과 충돌 방지) */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <ResultHoverActionBar
                    hovered={viewerHovered}
                    summary={
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontSize: 12,
                          }}
                          title={afterItem.prompt}
                        >
                          {afterItem.prompt}
                        </span>
                        <span
                          className="mono"
                          style={{
                            fontSize: 10.5,
                            color: "rgba(255,255,255,.72)",
                            letterSpacing: ".04em",
                            flexShrink: 0,
                          }}
                        >
                          {afterItem.width}×{afterItem.height}
                        </span>
                      </div>
                    }
                  >
                    <ActionBarButton
                      icon="zoom-in"
                      title="크게 보기"
                      onClick={() => setLightboxSrc(afterItem.imageRef)}
                    />
                    <ActionBarButton
                      icon="download"
                      title="저장"
                      onClick={() =>
                        downloadImage(
                          afterItem.imageRef,
                          filenameFromRef(
                            afterItem.imageRef,
                            `ais-edit-${afterItem.id}.png`,
                          ),
                        )
                      }
                    />
                    <ActionBarButton
                      icon="edit"
                      title="이 결과를 다음 수정의 원본으로"
                      onClick={() => {
                        setSource(
                          afterItem.imageRef,
                          `${afterItem.label} · ${afterItem.width}×${afterItem.height}`,
                          afterItem.width,
                          afterItem.height,
                        );
                        setAfterId(null); // 비교 슬라이더 초기화
                        toast.info("원본으로 지정", afterItem.label);
                      }}
                    />
                    <ActionBarButton
                      icon="refresh"
                      title="수정 설정 복원 (다시)"
                      onClick={() => {
                        setPrompt(afterItem.prompt);
                        setLightning(afterItem.lightning);
                        toast.info("수정 설정 복원", "[수정 생성] 눌러");
                      }}
                    />
                  </ResultHoverActionBar>
                </div>
                </div>
              </div>

              {/* 비교 분석 카드 — 수정 결과 대 원본 5축 평가 (Q2: 1차 유지) */}
              <ComparisonAnalysisCard
                item={afterItem}
                busy={isBusy(afterItem.id)}
                onAnalyze={() => analyze(afterItem)}
                onOpenDetail={() => setComparisonModalOpen(true)}
                onReanalyze={() => analyze(afterItem)}
              />
            </>
          ) : (
            // audit R2-7: 공통 StudioEmptyState 로 교체
            <StudioEmptyState size="normal">
              {!sourceImage
                ? "왼쪽에서 원본 이미지를 업로드해 주세요."
                : "이 원본의 수정 결과가 아직 없습니다. [수정 생성] 또는 아래 히스토리에서 선택하면 표시됩니다."}
            </StudioEmptyState>
          )}

          {/* ── 히스토리 섹션 헤더 (4 메뉴 공용) ── */}
          <HistorySectionHeader
            title="수정 히스토리"
            count={editResults.length}
            actions={
              <IconBtn
                icon="grid"
                title={`그리드 (${gridCols} 컬럼 · 클릭으로 변경)`}
                onClick={cycleGrid}
              />
            }
          />

          {/* 갤러리 — 자연 페이지 스크롤 (2026-04-26 maxHeight 박스 제거) */}
          <HistoryGallery
              items={editResults}
              gridCols={gridCols}
              selectedId={afterId}
              onTileClick={(it) => {
                // 히스토리 타일 클릭 = "이 수정 다시 보기"
                // sourceRef 있으면 원본도 같이 복원해 진짜 한 쌍 슬라이더로 표시.
                // sourceRef 없는 옛 row 는 안내 + source 보존 (슬라이더 자동 빈 상태).
                if (it.sourceRef) {
                  setSource(
                    it.sourceRef,
                    `${it.label} · ${it.width}×${it.height}`,
                    it.width,
                    it.height,
                  );
                } else {
                  toast.info(
                    "옛 항목 · 원본 미저장",
                    "Before/After 슬라이더는 표시되지 않습니다.",
                  );
                }
                setAfterId(it.id);
                selectHistory(it.id);
              }}
              onTileExpand={(it) => setLightboxSrc(it.imageRef)}
              onAfterDelete={(it) => {
                if (afterId === it.id) setAfterId(null);
              }}
              onUseAsSource={(it) => {
                // 이 결과 이미지를 다시 수정 원본으로 (연속 수정 플로우)
                setSource(
                  it.imageRef,
                  `${it.label} · ${it.width}×${it.height}`,
                  it.width,
                  it.height,
                );
                setAfterId(null); // 비교 슬라이더 초기화
                toast.info("원본으로 지정", it.label);
              }}
              emptyMessage="아직 수정 결과가 없습니다. 왼쪽에서 이미지를 업로드하고 [수정 생성]을 눌러주세요."
            />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}

