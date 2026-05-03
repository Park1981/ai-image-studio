/**
 * Vision Analyzer Page — 단일 이미지 분석 보조 기능.
 * 2026-04-24 · C5.
 *
 * 레이아웃: 좌 400px (업로드 + [분석] 버튼) / 우 1fr (결과 카드 + 최근 분석 그리드).
 * 생성/수정 페이지와 동일한 Chrome + sticky CTA 스타일 유지.
 */

"use client";

import { motion } from "framer-motion";

import AppHeader from "@/components/chrome/AppHeader";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import ProgressModal from "@/components/studio/ProgressModal";
import SourceImageCard from "@/components/studio/SourceImageCard";
import StudioResultHeader, {
  SectionAccentBar,
} from "@/components/studio/StudioResultHeader";
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
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import { MAX_VISION_HISTORY, useVisionStore } from "@/stores/useVisionStore";

// 임시 비교 카드 (2026-05-04) — qwen3-vl:8b vs 8b-thinking-q8_0 검증용.
// Ollama 재시동 없이 분석 시점에 모델 변경 가능 (useSettingsStore.visionModel persist).
// 시그니처 색: 8B = Cyan (#06b6d4 · Cool/빠름) / Thinking = Amber (#f59e0b · Warm/사색).
// 영상 모델 카드 패턴 채택 (framer-motion flexGrow 1.7/1.0 spring + filter dim).
const VISION_MODEL_OPTIONS = [
  {
    id: "qwen3-vl:8b",
    label: "8B",
    bgImage: "/vision-models/8b.png",
    accentColor: "#06b6d4",
    glowRgba: "rgba(6, 182, 212, 0.45)",
  },
  {
    id: "qwen3-vl:8b-thinking-q8_0",
    label: "Thinking",
    bgImage: "/vision-models/thinking.png",
    accentColor: "#f59e0b",
    glowRgba: "rgba(245, 158, 11, 0.45)",
  },
] as const;

// 영상 카드 패턴 (Phase 5 follow-up 3 · 2026-05-03) 그대로 채택.
const ACTIVE_FLEX = 1.7;
const INACTIVE_FLEX = 1;
const SPRING_TRANSITION = {
  type: "spring" as const,
  stiffness: 320,
  damping: 26,
};

/* dataURL 의 base64 길이로 byte 추정 (URL 이면 0). */
function estimateDataUrlBytes(dataUrl: string | null): number {
  if (!dataUrl || !dataUrl.startsWith("data:")) return 0;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  return Math.round((dataUrl.length - comma - 1) * 0.75);
}

/* bytes → 사람이 읽는 단위 (B/KB/MB). */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* 분석 결과 헤더 메타 pills — 파일명 / 해상도(violet) / 확장자 / 파일 크기. */
function renderVisionMeta(
  image: string | null,
  label: string,
  width: number | null,
  height: number | null,
) {
  if (!image) return null;
  const filename = label.split(" · ")[0] || "";
  const ext = filename.includes(".")
    ? (filename.split(".").pop() || "").toUpperCase()
    : "";
  const truncatedName =
    filename.length > 22
      ? `${filename.slice(0, 14)}…${filename.slice(-5)}`
      : filename;
  const bytes = estimateDataUrlBytes(image);
  const sizeLabel = formatBytes(bytes);
  return (
    <>
      {filename && (
        <span className="ais-result-pill mono" title={filename}>
          {truncatedName}
        </span>
      )}
      {width && height && (
        <span className="ais-result-pill ais-pill-violet mono">
          {width} × {height}
        </span>
      )}
      {ext && <span className="ais-result-pill mono">{ext}</span>}
      {sizeLabel && <span className="ais-result-pill mono">{sizeLabel}</span>}
    </>
  );
}

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

  /* ── 임시 모델 토글 (2026-05-04 비교 검증용) ── */
  const visionModel = useSettingsStore((s) => s.visionModel);
  const setVisionModel = useSettingsStore((s) => s.setVisionModel);


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
          </div>

          {/* ── 원본 이미지 (Edit/Video 와 통일 — .ais-field-header + SectionAccentBar) ── */}
          <div>
            <div className="ais-field-header">
              <label
                className="ais-field-label"
                style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
              >
                <SectionAccentBar accent="blue" />
                원본 이미지
              </label>
              <span className="mono ais-field-meta">
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

          {/* ── 모델 비교 카드 (2026-05-04 · 영상 카드 패턴 채택 · framer-motion flexGrow) ── */}
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
            <div
              role="radiogroup"
              aria-label="Vision 모델 선택"
              style={{
                display: "flex",
                gap: 8,
                width: "100%",
              }}
            >
              {VISION_MODEL_OPTIONS.map((opt) => {
                const active = visionModel === opt.id;
                return (
                  <motion.button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${opt.label} 모델 선택`}
                    disabled={analyzing}
                    onClick={() => setVisionModel(opt.id)}
                    animate={{
                      flexGrow: active ? ACTIVE_FLEX : INACTIVE_FLEX,
                      scale: active ? 1 : 0.97,
                    }}
                    transition={SPRING_TRANSITION}
                    style={{
                      flexBasis: 0,
                      minWidth: 0,
                      position: "relative",
                      minHeight: 88,
                      borderRadius: 14,
                      border: "none",
                      padding: 0,
                      cursor: analyzing ? "not-allowed" : "pointer",
                      overflow: "hidden",
                      backgroundImage: `url("${opt.bgImage}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center right",
                      backgroundRepeat: "no-repeat",
                      transition: "filter 220ms ease, box-shadow 220ms ease",
                      opacity: analyzing ? 0.55 : 1,
                      outline: "none",
                      boxShadow: active
                        ? `0 0 0 2px ${opt.accentColor}, 0 6px 18px ${opt.glowRgba}`
                        : "0 0 0 1px rgba(148, 163, 184, 0.22), 0 1px 4px rgba(0, 0, 0, 0.18)",
                      filter: active ? "none" : "saturate(0.65) brightness(0.72)",
                    }}
                  >
                    {/* 좌측 어두운 gradient overlay — 모델명 가독성 (인물/사진은 우측에 위치). */}
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        background:
                          "linear-gradient(90deg, rgba(15,23,42,0.72) 0%, rgba(15,23,42,0.42) 42%, rgba(15,23,42,0) 70%)",
                        pointerEvents: "none",
                      }}
                    />
                    {/* 모델명 — 좌측 세로 중앙 (영상 카드 패턴). */}
                    <div
                      style={{
                        position: "absolute",
                        left: 16,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#f8fafc",
                        fontSize: 16,
                        fontWeight: 700,
                        letterSpacing: "-0.005em",
                        lineHeight: 1.2,
                        textShadow: "0 2px 8px rgba(0, 0, 0, 0.55)",
                        pointerEvents: "none",
                        maxWidth: "70%",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {opt.label}
                    </div>
                  </motion.button>
                );
              })}
            </div>
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
            meta={renderVisionMeta(currentImage, currentLabel, currentWidth, currentHeight)}
          />

          <VisionResultCard result={lastResult} running={analyzing} />

          {/* ── V5 Archive Header (Edit/Generate 와 통일 · 2026-05-03) ──
           *  "모두 지우기" 액션은 actions 슬롯으로. countLabel "/ 100" 으로
           *  Vision 만의 localStorage cap 정보 유지. */}
          <HistorySectionHeader
            title="보관"
            titleEn="History"
            count={entries.length}
            countLabel={`/ ${MAX_VISION_HISTORY}`}
            actions={
              entries.length > 0 ? (
                <button
                  type="button"
                  className="ais-vision-history-clear"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      const ok = window.confirm("모든 분석 기록을 지울까?");
                      if (!ok) return;
                    }
                    clearEntries();
                  }}
                >
                  모두 지우기
                </button>
              ) : null
            }
          />

          <VisionHistoryList
            entries={entries}
            onSelect={loadEntry}
            onDelete={removeEntry}
          />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}
