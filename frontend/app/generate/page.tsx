/**
 * Generate Mode Page — Zustand 스토어 + Mock API 연결.
 * 프롬프트/고급 설정은 useGenerateStore, 히스토리는 useHistoryStore, 프리퍼런스는 useSettingsStore.
 * 입력값은 부분 영속화, 진행 상태는 세션 한정.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryItem } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { IconBtn } from "@/components/chrome/Chrome";
import AppHeader from "@/components/chrome/AppHeader";
import HistoryGallery from "@/components/studio/HistoryGallery";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import ImageLightbox from "@/components/studio/ImageLightbox";
import ProgressModal from "@/components/studio/ProgressModal";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import ResearchBanner from "@/components/studio/ResearchBanner";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import {
  StudioLeftPanel,
  StudioModeHeader,
  StudioPage,
  StudioRightPanel,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import UpgradeConfirmModal from "@/components/studio/UpgradeConfirmModal";
import Icon from "@/components/ui/Icon";
import {
  Field,
  Range,
  Spinner,
  Toggle,
  inputStyle,
  iconBtnStyle,
} from "@/components/ui/primitives";
import { ASPECT_RATIOS, type AspectRatioLabel } from "@/lib/model-presets";
import {
  downloadImage,
  copyImageToClipboard,
  filenameFromRef,
  urlToDataUrl,
} from "@/lib/image-actions";
import { useGeneratePipeline } from "@/hooks/useGeneratePipeline";
import { useEditStore } from "@/stores/useEditStore";
import { useGenerateStore, type AspectValue } from "@/stores/useGenerateStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

export default function GeneratePage() {
  const router = useRouter();

  /* ── store subscribe ── */
  const prompt = useGenerateStore((s) => s.prompt);
  const setPrompt = useGenerateStore((s) => s.setPrompt);
  const aspect = useGenerateStore((s) => s.aspect);
  const setAspect = useGenerateStore((s) => s.setAspect);
  const width = useGenerateStore((s) => s.width);
  const height = useGenerateStore((s) => s.height);
  const setWidth = useGenerateStore((s) => s.setWidth);
  const setHeight = useGenerateStore((s) => s.setHeight);
  const setDimensions = useGenerateStore((s) => s.setDimensions);
  const aspectLocked = useGenerateStore((s) => s.aspectLocked);
  const setAspectLocked = useGenerateStore((s) => s.setAspectLocked);
  const research = useGenerateStore((s) => s.research);
  const setResearch = useGenerateStore((s) => s.setResearch);
  const lightning = useGenerateStore((s) => s.lightning);
  const applyLightning = useGenerateStore((s) => s.applyLightning);
  const generating = useGenerateStore((s) => s.generating);
  const progress = useGenerateStore((s) => s.progress);
  const stage = useGenerateStore((s) => s.stage);

  const items = useHistoryStore((s) => s.items);
  const selectedId = useHistoryStore((s) => s.selectedId);
  const selectItem = useHistoryStore((s) => s.select);

  const lightningByDefault = useSettingsStore((s) => s.lightningByDefault);
  const addTemplate = useSettingsStore((s) => s.addTemplate);

  /* ── 파이프라인 훅 (스트림 + 업그레이드 모달 + 조사) ── */
  const pipeline = useGeneratePipeline();
  const handleGenerate = pipeline.generate;
  const handleUpgradeConfirm = pipeline.upgrade.confirm;
  const handleUpgradeRerun = pipeline.upgrade.rerun;
  const researchPreview = pipeline.researchPreview;

  /* ── 생성 모드에서만 보이는 히스토리 필터 ── */
  const genItems = useMemo(
    () => items.filter((i) => i.mode === "generate"),
    [items],
  );
  const selectedItem = genItems.find((i) => i.id === selectedId);

  /* ── Lightbox + 그리드 컬럼 토글 ── */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /* ── 결과 뷰어 호버 ── */
  const [viewerHovered, setViewerHovered] = useState(false);

  /* ── 진행 모달 open 상태 ──
   * generating false→true 전이 시 자동 오픈. React 공식 권장 패턴:
   * https://react.dev/reference/react/useState#storing-information-from-previous-renders
   */
  const [progressOpen, setProgressOpen] = useState(false);
  const [prevGenerating, setPrevGenerating] = useState(generating);
  if (prevGenerating !== generating) {
    setPrevGenerating(generating);
    if (generating) setProgressOpen(true);
  }

  // 생성 끝나고 1.2초 후 자동 close (단, 사용자가 이미 닫았다면 무시)
  useEffect(() => {
    if (generating) return;
    if (!progressOpen) return;
    const t = setTimeout(() => setProgressOpen(false), 1200);
    return () => clearTimeout(t);
  }, [generating, progressOpen]);

  /* ── 진입 시 Lightning 기본값 적용 (1회) ──
   * applyLightning 은 store action (setState 트리거) 이지만 mount 1회만이라 effect 가 적합.
   */
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (lightningByDefault && !lightning) applyLightning(true);
  }, [lightningByDefault, lightning, applyLightning]);

  /* ── 진입 시 프롬프트는 빈 입력으로 시작 ── */
  const promptClearedRef = useRef(false);
  useEffect(() => {
    if (promptClearedRef.current) return;
    promptClearedRef.current = true;
    setPrompt("");
  }, [setPrompt]);

  /* ── 프롬프트 textarea auto-grow (내용 높이에 맞춰 자동 확장) ── */
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const autoGrow = (el: HTMLTextAreaElement) => {
    // scrollHeight 는 정확한 content 높이 — 'auto' 로 먼저 리셋해야 줄어들기도 가능.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  // 마운트 직후 + prompt 외부 변경(템플릿 선택/재생성 복원 등) 시 재측정
  useEffect(() => {
    if (promptTextareaRef.current) autoGrow(promptTextareaRef.current);
  }, [prompt]);

  const sizeLabel = `${width}×${height}`;

  return (
    <StudioPage>
      {progressOpen && (
        <ProgressModal mode="generate" onClose={() => setProgressOpen(false)} />
      )}
      <UpgradeConfirmModal
        open={pipeline.upgrade.open}
        loading={pipeline.upgrade.loading}
        original={prompt}
        result={pipeline.upgrade.result}
        onConfirm={handleUpgradeConfirm}
        onRerun={handleUpgradeRerun}
        onCancel={pipeline.upgrade.cancel}
      />
      <ImageLightbox
        src={lightboxSrc}
        item={selectedItem}
        alt={selectedItem?.label}
        filename={
          selectedItem
            ? filenameFromRef(
                selectedItem.imageRef,
                `ais-${selectedItem.id}.png`,
              )
            : undefined
        }
        onClose={() => setLightboxSrc(null)}
        onDownload={() => {
          if (selectedItem) {
            downloadImage(
              selectedItem.imageRef,
              filenameFromRef(
                selectedItem.imageRef,
                `ais-${selectedItem.id}.png`,
              ),
            );
          }
        }}
      />
      <AppHeader />

      <StudioWorkspace>
        {/* ── LEFT: 입력 영역 ── */}
        <StudioLeftPanel>
          <StudioModeHeader
            title="Image Generate"
            description="프롬프트를 다듬고 로컬 ComfyUI로 이미지를 생성합니다."
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
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--ink-2)",
                  letterSpacing: 0,
                }}
              >
                프롬프트
              </label>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: "var(--ink-4)" }}
              >
                {prompt.length} chars · KO
              </span>
            </div>
            <div
              style={{
                position: "relative",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius)",
                transition: "border .15s",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              {/* 숨김 스프링 프롬프트 히스토리 메뉴 (우상단) */}
              <PromptHistoryPeek
                mode="generate"
                onSelect={(p) => setPrompt(p)}
              />
              <textarea
                ref={promptTextareaRef}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  autoGrow(e.target);
                }}
                placeholder="자연어로 자유롭게 입력. 예: 책 읽는 고양이, 창가, 늦은 오후..."
                rows={3}
                style={{
                  display: "block",
                  width: "100%",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  background: "transparent",
                  padding: "14px 44px 38px 16px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--ink)",
                  borderRadius: "var(--radius)",
                  // auto-grow: 내용만큼만 커지고 상한(60vh) 에서 멈춰 내부 스크롤.
                  minHeight: 96,
                  maxHeight: "60vh",
                  overflowY: "auto",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 10,
                  right: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--ink-4)",
                }}
              >
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
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      fontSize: 11,
                      color: "var(--accent-ink)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title="현재 프롬프트를 템플릿으로 저장"
                  >
                    <Icon name="sparkle" size={11} /> 템플릿 저장
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrompt("")}
                    title="프롬프트 비우기"
                    style={{
                      // edit/video 와 동일 스타일 — 4 페이지 "비우기" 버튼 통일.
                      all: "unset",
                      cursor: "pointer",
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
                </div>
              </div>
            </div>
          </div>

          {/* Claude 프롬프트 조사 배너 — 힌트 인라인 표시 */}
          <ResearchBanner
            checked={research}
            onChange={setResearch}
            onPreview={researchPreview.run}
            loading={researchPreview.loading}
            hints={researchPreview.hints}
            error={researchPreview.error}
          />

          {/* Lightning toggle — /edit 페이지와 동일 패턴 (카드 없이 Toggle 직접) */}
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

          {/* 사이즈 — 단독 카드 */}
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

          {/* Primary CTA — sticky 하단 (페이지 스크롤 시 viewport 하단에 고정) */}
          <div
            style={{
              position: "sticky",
              bottom: 12,
              marginTop: "auto",
              paddingTop: 10,
              zIndex: 4,
              // 하단 그라데이션으로 "떠있는 느낌"
              background:
                "linear-gradient(to bottom, transparent, var(--bg) 45%)",
            }}
          >
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            style={{
              all: "unset",
              cursor: generating || !prompt.trim() ? "not-allowed" : "pointer",
              textAlign: "center",
              background:
                generating || !prompt.trim()
                  ? "var(--accent-disabled)"
                  : "var(--accent)",
              color: "#fff",
              padding: "14px 20px",
              borderRadius: "var(--radius-full)",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              boxSizing: "border-box",
              boxShadow: generating
                ? "none"
                : "0 4px 18px rgba(74,158,255,.42), inset 0 1px 0 rgba(255,255,255,.2)",
              transition: "all .18s",
              position: "relative",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              if (!generating && prompt.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--accent-ink)";
            }}
            onMouseLeave={(e) => {
              if (!generating && prompt.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--accent)";
            }}
          >
            {generating ? (
              <>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${progress}%`,
                    background: "rgba(255,255,255,.18)",
                    transition: "width .2s",
                  }}
                />
                <span
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Spinner />
                  {stage} · {Math.round(progress)}%
                </span>
              </>
            ) : (
              <>
                <Icon name="sparkle" size={15} />
                생성
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    opacity: 0.8,
                    fontWeight: 500,
                    marginLeft: 4,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "rgba(255,255,255,.18)",
                  }}
                >
                  ⇧↵
                </span>
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
            평균 소요{" "}
            <span className="mono">~{research ? "42" : "28"}s</span> · 로컬 처리 ·
            데이터 전송 없음
          </div>
          </div>
        </StudioLeftPanel>

        {/* ── RIGHT: 갤러리 ── */}
        <StudioRightPanel>
          {/* ── 결과 영역 헤더 (audit R2-6: 공통 StudioResultHeader 로 교체) ── */}
          <StudioResultHeader
            title="생성 결과"
            meta={
              selectedItem
                ? `${selectedItem.width}×${selectedItem.height}`
                : "PNG"
            }
          />

          {/* ── 결과 뷰어 (선택된 아이템 있을 때 · 이미지 + 호버 액션바) ── */}
          {selectedItem ? (
            <GenerateResultViewer
              item={selectedItem}
              hovered={viewerHovered}
              onEnter={() => setViewerHovered(true)}
              onLeave={() => setViewerHovered(false)}
              onExpand={() => setLightboxSrc(selectedItem.imageRef)}
              onDownload={() =>
                downloadImage(
                  selectedItem.imageRef,
                  filenameFromRef(
                    selectedItem.imageRef,
                    `ais-${selectedItem.id}.png`,
                  ),
                )
              }
              onCopy={() => copyImageToClipboard(selectedItem.imageRef)}
              onSendToEdit={async () => {
                toast.info("수정으로 전송 중…");
                const res = await urlToDataUrl(selectedItem.imageRef);
                if (!res) {
                  toast.error("전송 실패", "이미지를 불러올 수 없음");
                  return;
                }
                useEditStore
                  .getState()
                  .setSource(
                    res.dataUrl,
                    `${selectedItem.label} · ${res.width}×${res.height}`,
                    res.width,
                    res.height,
                  );
                router.push("/edit");
              }}
              onReuse={() => {
                // 재생성 = 프롬프트 + 사이즈 + Lightning 복원.
                // Seed/Step/CFG 는 UI 제거 + 매번 랜덤 정책이라 복원 안 함.
                setPrompt(selectedItem.prompt);
                setDimensions(selectedItem.width, selectedItem.height);
                if (selectedItem.lightning !== lightning) {
                  applyLightning(selectedItem.lightning);
                }
                toast.info(
                  "재생성 준비",
                  `${selectedItem.width}×${selectedItem.height} · [생성] 눌러`,
                );
              }}
            />
          ) : (
            // audit R2-6: 공통 StudioEmptyState 로 교체
            <StudioEmptyState size="normal">
              아직 생성된 이미지가 없습니다. 프롬프트 입력 후 <b>생성</b> 버튼을
              눌러 주세요.
            </StudioEmptyState>
          )}

          {/* ── 히스토리 섹션 헤더 (4 메뉴 공용) ── */}
          <HistorySectionHeader
            title="생성 히스토리"
            count={genItems.length}
            actions={
              <IconBtn
                icon="grid"
                title={`그리드 (${gridCols} 컬럼 · 클릭으로 변경)`}
                onClick={cycleGrid}
              />
            }
          />

          {/* ── 갤러리 — 자연 페이지 스크롤 (2026-04-26 maxHeight 박스 제거) ──
              날짜 섹션 접기 + height-aware Masonry 가 정보 밀도 관리. */}
          <HistoryGallery
            items={genItems}
            gridCols={gridCols}
            selectedId={selectedId ?? null}
            onTileClick={(it) => selectItem(it.id)}
            onTileExpand={(it) => setLightboxSrc(it.imageRef)}
            emptyMessage={null}
          />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}

/* ─────────────────────────────────
   사이즈 카드 (지역 컴포넌트) — W/H 입력 + 슬라이더 + 비율잠금 + 비율칩
   2026-04-25: AdvancedAccordion → SizeCard 분리 (Lightning 은 호출부에서 직접 노출)
   ───────────────────────────────── */
function SizeCard({
  aspect,
  sizeLabel,
  width,
  height,
  aspectLocked,
  onAspect,
  onWidth,
  onHeight,
  onAspectLocked,
}: {
  aspect: AspectValue;
  sizeLabel: string;
  width: number;
  height: number;
  aspectLocked: boolean;
  onAspect: (v: AspectRatioLabel) => void;
  onWidth: (v: number) => void;
  onHeight: (v: number) => void;
  onAspectLocked: (v: boolean) => void;
}) {
  // 입력 중 raw string — blur/Enter 시에만 store 커밋 (중간값 clamp 방지)
  const [rawW, setRawW] = useState(String(width));
  const [rawH, setRawH] = useState(String(height));

  // store 값이 외부에서 바뀌면(프리셋 칩 클릭 등) raw 도 동기화.
  // React 19 권장: prev state 비교 (effect 안 setState 회피).
  const [prevW, setPrevW] = useState(width);
  const [prevH, setPrevH] = useState(height);
  if (prevW !== width) {
    setPrevW(width);
    setRawW(String(width));
  }
  if (prevH !== height) {
    setPrevH(height);
    setRawH(String(height));
  }

  const commitW = () => { const n = parseInt(rawW, 10); if (!isNaN(n)) onWidth(n); else setRawW(String(width)); };
  const commitH = () => { const n = parseInt(rawH, 10); if (!isNaN(n)) onHeight(n); else setRawH(String(height)); };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        transition: "all .2s",
        padding: "14px 16px 16px",
      }}
    >
      <Field
        label={`사이즈 · ${sizeLabel}${aspect === "custom" ? "" : ` · ${aspect}`}`}
      >
            {/* W/H 세트 — 각 입력박스 바로 아래에 동일 너비 슬라이더 (컴팩트) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* W 세트 (input + slider 세로) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
                <DimInput
                  label="W"
                  raw={rawW}
                  onRaw={setRawW}
                  onCommit={commitW}
                />
                <Range
                  min={768}
                  max={2048}
                  step={8}
                  value={Math.max(768, width)}
                  onChange={onWidth}
                />
              </div>

              {/* 비율잠금 버튼 — 두 열 사이 수직 가운데 정렬 */}
              <button
                type="button"
                onClick={() => onAspectLocked(!aspectLocked)}
                title={
                  aspectLocked
                    ? "비율 잠금 ON — 한쪽 수정 시 반대쪽 자동 계산"
                    : "비율 잠금 OFF — 자유 입력"
                }
                style={{
                  ...iconBtnStyle,
                  alignSelf: "center",
                  background: aspectLocked
                    ? "var(--accent-soft)"
                    : iconBtnStyle.background,
                  color: aspectLocked ? "var(--accent)" : iconBtnStyle.color,
                  borderColor: aspectLocked
                    ? "var(--accent)"
                    : iconBtnStyle.borderColor,
                }}
              >
                <Icon name={aspectLocked ? "lock" : "unlock"} size={13} />
              </button>

              {/* H 세트 — 비율잠금 ON 시 input · slider 모두 disabled */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
                <DimInput
                  label="H"
                  raw={rawH}
                  onRaw={setRawH}
                  onCommit={commitH}
                  disabled={aspectLocked}
                  disabledTitle="비율 잠금 해제 후 직접 입력 가능"
                />
                <Range
                  min={768}
                  max={2048}
                  step={8}
                  value={Math.max(768, height)}
                  onChange={onHeight}
                  disabled={aspectLocked}
                />
              </div>
            </div>
            {/* 프리셋 칩 — 원터치로 익숙한 비율 설정 */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginTop: 6,
              }}
            >
              {ASPECT_RATIOS.map((r) => {
                const active = aspect === r.label;
                return (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => onAspect(r.label)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      fontSize: 10.5,
                      fontWeight: 500,
                      padding: "3px 8px",
                      borderRadius: "var(--radius-full)",
                      border: `1px solid ${
                        active ? "var(--accent)" : "var(--line)"
                      }`,
                      background: active
                        ? "var(--accent-soft)"
                        : "transparent",
                      color: active ? "var(--accent)" : "var(--ink-3)",
                    }}
                    title={`${r.width}×${r.height}`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
      </Field>
    </div>
  );
}

/** W/H 차원 입력 — label prefix 를 input 안에 overlay 로 얹음 (컴팩트). */
function DimInput({
  label,
  raw,
  onRaw,
  onCommit,
  disabled = false,
  disabledTitle,
}: {
  label: "W" | "H";
  raw: string;
  onRaw: (v: string) => void;
  onCommit: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <span
        aria-hidden
        className="mono"
        style={{
          position: "absolute",
          left: 8,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 10,
          color: "var(--ink-4)",
          pointerEvents: "none",
          fontWeight: 500,
          letterSpacing: ".04em",
        }}
      >
        {label}
      </span>
      <input
        className="mono"
        type="number"
        min={768}
        max={2048}
        step={8}
        value={raw}
        disabled={disabled}
        onChange={(e) => onRaw(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onCommit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{
          ...inputStyle,
          width: "100%",
          paddingLeft: 22,
          textAlign: "right",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "auto",
        }}
        aria-label={label === "W" ? "width px" : "height px"}
        title={disabled ? disabledTitle : undefined}
      />
    </div>
  );
}

/* ─────────────────────────────────
   결과 뷰어 (이미지 + 호버 액션바)
   ───────────────────────────────── */

function GenerateResultViewer({
  item,
  hovered,
  onEnter,
  onLeave,
  onExpand,
  onDownload,
  onCopy,
  onSendToEdit,
  onReuse,
}: {
  item: HistoryItem;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onExpand: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onSendToEdit: () => void;
  onReuse: () => void;
}) {
  // 원본 비율 — width/height 없으면 1/1 폴백
  const aspectRatio =
    item.width > 0 && item.height > 0
      ? `${item.width} / ${item.height}`
      : "1 / 1";

  // 액션바 좌측 요약 — 프롬프트 한 줄 + 사이즈
  const summary = (
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
        title={item.prompt}
      >
        {item.prompt}
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
        {item.width}×{item.height}
      </span>
    </div>
  );

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "relative",
        width: "100%",
        // 결과 뷰어: 원본 비율 유지 + 최대 높이 65vh 제한. contain 으로 레터박스.
        aspectRatio,
        maxHeight: "65vh",
        background: "var(--bg-2)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
        cursor: "zoom-in",
      }}
      onClick={(e) => {
        // 액션바 버튼 클릭과 구분 — 버튼은 stopPropagation 로 이벤트 차단되니
        // 여기로 올라온 건 이미지 영역 클릭.
        e.stopPropagation();
        onExpand();
      }}
    >
      {/* 이미지 본체 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.imageRef}
        alt={item.label}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
          // 드래그 고스트 방지
          // @ts-expect-error — 비표준 Webkit
          WebkitUserDrag: "none",
          userSelect: "none",
        }}
      />

      {/* 하단 호버 액션바 */}
      <div onClick={(e) => e.stopPropagation()}>
        <ResultHoverActionBar hovered={hovered} summary={summary}>
          <ActionBarButton
            icon="zoom-in"
            title="크게 보기"
            onClick={onExpand}
          />
          <ActionBarButton
            icon="download"
            title="저장"
            onClick={onDownload}
          />
          <ActionBarButton icon="copy" title="클립보드 복사" onClick={onCopy} />
          <ActionBarButton
            icon="edit"
            title="수정으로"
            onClick={onSendToEdit}
          />
          <ActionBarButton
            icon="refresh"
            title="재생성 (파라미터 복원)"
            onClick={onReuse}
          />
        </ResultHoverActionBar>
      </div>
    </div>
  );
}

