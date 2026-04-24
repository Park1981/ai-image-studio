/**
 * Video Page — LTX-2.3 Image-to-Video (i2v) 실구현.
 * 2026-04-24 · V7.
 *
 * 레이아웃은 Edit 페이지와 유사 (좌 400px · 우 1fr).
 *  - 좌: SourceImageCard + 프롬프트 textarea + [영상 생성] CTA
 *  - 우: VideoPlayerCard + 파이프라인 5단계 + 수정 히스토리 갤러리 (mode=video)
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BackBtn,
  IconBtn,
  Logo,
  ModelBadge,
  TopBar,
} from "@/components/chrome/Chrome";
import VramBadge from "@/components/chrome/VramBadge";
import SettingsButton from "@/components/settings/SettingsButton";
import HistoryGallery from "@/components/studio/HistoryGallery";
import HistorySectionHeader from "@/components/studio/HistorySectionHeader";
import ImageLightbox from "@/components/studio/ImageLightbox";
import PipelineSteps, {
  type PipelineStepMeta,
} from "@/components/studio/PipelineSteps";
import ProgressModal from "@/components/studio/ProgressModal";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import SourceImageCard from "@/components/studio/SourceImageCard";
import StudioResultHeader from "@/components/studio/StudioResultHeader";
import {
  StudioLeftPanel,
  StudioModeHeader,
  StudioPage,
  StudioRightPanel,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import VideoPlayerCard from "@/components/studio/VideoPlayerCard";
import Icon from "@/components/ui/Icon";
import { Spinner, Toggle } from "@/components/ui/primitives";
import { useVideoPipeline } from "@/hooks/useVideoPipeline";
import { filenameFromRef } from "@/lib/image-actions";
import type { HistoryItem } from "@/lib/api-client";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { toast } from "@/stores/useToastStore";
import {
  computeVideoResize,
  useVideoStore,
  VIDEO_LONGER_EDGE_MAX,
  VIDEO_LONGER_EDGE_MIN,
  VIDEO_LONGER_EDGE_STEP,
} from "@/stores/useVideoStore";

/* LTX-2.3 i2v 파이프라인 5단계 — qwen2.5vl + gemma4 + ComfyUI 2-stage + save */
const PIPELINE_META: PipelineStepMeta[] = [
  { n: 1, label: "이미지 비전 분석", model: "qwen2.5vl" },
  { n: 2, label: "영상 프롬프트 통합", model: "gemma4-un" },
  { n: 3, label: "워크플로우 구성", model: "LTX i2v builder" },
  { n: 4, label: "ComfyUI 샘플링 (2-stage)", model: "ltx-2.3-22b-fp8" },
  { n: 5, label: "MP4 저장", model: "CreateVideo + SaveVideo" },
];

export default function VideoPage() {
  const router = useRouter();

  /* ── store ── */
  const sourceImage = useVideoStore((s) => s.sourceImage);
  const sourceLabel = useVideoStore((s) => s.sourceLabel);
  const sourceWidth = useVideoStore((s) => s.sourceWidth);
  const sourceHeight = useVideoStore((s) => s.sourceHeight);
  const setSource = useVideoStore((s) => s.setSource);
  const prompt = useVideoStore((s) => s.prompt);
  const setPrompt = useVideoStore((s) => s.setPrompt);
  const adult = useVideoStore((s) => s.adult);
  const setAdult = useVideoStore((s) => s.setAdult);
  const longerEdge = useVideoStore((s) => s.longerEdge);
  const setLongerEdge = useVideoStore((s) => s.setLongerEdge);
  const lightning = useVideoStore((s) => s.lightning);
  const setLightning = useVideoStore((s) => s.setLightning);
  const running = useVideoStore((s) => s.running);
  const currentStep = useVideoStore((s) => s.currentStep);
  const stepDone = useVideoStore((s) => s.stepDone);
  // pipelineProgress 는 audit P1b 에서 CTA/VideoPlayerCard 모두 제거. ProgressModal 에서 직접 구독.
  const pipelineLabel = useVideoStore((s) => s.pipelineLabel);
  const lastVideoRef = useVideoStore((s) => s.lastVideoRef);

  const items = useHistoryStore((s) => s.items);

  // visionModel 은 useVideoPipeline 내부에서 store 직접 읽음 (여기 구독 불필요)
  const comfyuiStatus = useProcessStore((s) => s.comfyui);

  /* ── 파이프라인 훅 ── */
  const { generate: handleGenerate } = useVideoPipeline();

  /* ── 영상 히스토리 (mode=video 만) ── */
  const videoResults = items.filter((x) => x.mode === "video");

  /* ── 컬럼 토글 (Generate/Edit 일관) ── */
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /* ── 현재 재생할 mp4: lastVideoRef (세션) 우선, 없으면 최근 video 히스토리 ── */
  const playingRef =
    lastVideoRef ?? (videoResults.length > 0 ? videoResults[0].imageRef : null);

  /* ── 진행 모달 open 상태 ──
   * running false→true 전이 시 자동 오픈. React 공식 권장: prev state 비교.
   */
  const [progressOpen, setProgressOpen] = useState(false);
  const [prevRunning, setPrevRunning] = useState(running);
  if (prevRunning !== running) {
    setPrevRunning(running);
    if (running) setProgressOpen(true);
  }

  /* ── Lightbox (자세히 누르면 오픈) ── */
  const [lightboxItem, setLightboxItem] = useState<HistoryItem | null>(null);

  useEffect(() => {
    if (running) return;
    if (!progressOpen) return;
    const t = setTimeout(() => setProgressOpen(false), 1400);
    return () => clearTimeout(t);
  }, [running, progressOpen]);

  /* ── 프롬프트 textarea auto-grow (Gen/Edit 일관) ── */
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    if (promptTextareaRef.current) autoGrow(promptTextareaRef.current);
  }, [prompt]);

  /* ── 진입 시 영상 지시는 빈 입력으로 시작 ── */
  const promptClearedRef = useRef(false);
  useEffect(() => {
    if (promptClearedRef.current) return;
    promptClearedRef.current = true;
    setPrompt("");
  }, [setPrompt]);

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
    <StudioPage>
      {progressOpen && (
        <ProgressModal mode="video" onClose={() => setProgressOpen(false)} />
      )}
      {lightboxItem && (
        <ImageLightbox
          src={lightboxItem.imageRef}
          alt={lightboxItem.label}
          filename={filenameFromRef(lightboxItem.imageRef, "ais-video.mp4")}
          item={lightboxItem}
          onClose={() => setLightboxItem(null)}
        />
      )}
      <TopBar
        left={
          <>
            <BackBtn onClick={() => router.push("/")} />
            <Logo />
          </>
        }
        center={
          <ModelBadge
            name="LTX Video 2.3"
            tag="22B · A/V"
            status={comfyuiStatus === "running" ? "ready" : "loading"}
          />
        }
        right={
          <>
            <VramBadge />
            <SettingsButton />
          </>
        }
      />

      <StudioWorkspace>
        {/* ── LEFT: 업로드 + 프롬프트 + CTA ── */}
        <StudioLeftPanel>
          <StudioModeHeader
            title="Video Generate"
            description="원본 이미지와 영상 지시로 5초 MP4를 생성합니다."
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
                }}
              >
                원본 이미지
              </label>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: "var(--ink-4)" }}
              >
                {sourceWidth && sourceHeight
                  ? `${sourceWidth}×${sourceHeight}`
                  : "—"}
              </span>
            </div>
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
              <label
                style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}
              >
                영상 지시
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
              <PromptHistoryPeek mode="video" onSelect={(p) => setPrompt(p)} />
              <textarea
                ref={promptTextareaRef}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  autoGrow(e.target);
                }}
                placeholder="어떤 움직임/카메라/분위기의 영상? 예: 느린 달리 인, 창가 빛 변화..."
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
                  maxHeight: "60vh",
                  overflowY: "auto",
                }}
              />
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
                    borderRadius: 6,
                  }}
                >
                  <Icon name="x" size={10} /> 비우기
                </button>
              )}
            </div>
          </div>

          {/* 영상 해상도 슬라이더 — 긴 변 픽셀, 원본 비율 유지 */}
          <VideoResolutionSlider
            longerEdge={longerEdge}
            setLongerEdge={setLongerEdge}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
          />

          <Toggle
            checked={lightning}
            onChange={setLightning}
            label={lightning ? "Lightning 4-step" : "고품질 30-step"}
            desc={
              lightning
                ? "빠른 생성 · 약 5분 · 얼굴 변할 수 있음"
                : "Full step · 약 20분+ · 얼굴 보존 우선"
            }
          />

          <Toggle
            checked={adult}
            onChange={setAdult}
            label={adult ? "성인 모드 켜짐" : "성인 모드 꺼짐"}
            desc={
              adult
                ? "에로틱 모션 + NSFW LoRA 적용"
                : "SFW 프롬프트 · 얼굴 보존 안정"
            }
          />

          {/* Pipeline (5단계 초록박스) */}
          <PipelineSteps
            steps={PIPELINE_META}
            stepDone={stepDone}
            currentStep={currentStep}
            running={running}
            lightning={false}
          />

          {/* VRAM 주의 배너 */}
          <div
            style={{
              padding: "10px 12px",
              background: "var(--amber-soft)",
              border: "1px solid rgba(250,173,20,.35)",
              borderRadius: 10,
              fontSize: 11.5,
              color: "var(--amber-ink)",
              lineHeight: 1.55,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 600,
                marginBottom: 3,
              }}
            >
              <Icon name="search" size={12} />
              16GB VRAM 주의
            </div>
            공식 fp8 체크포인트(29GB)는 VRAM 초과. NVIDIA Control Panel →
            “CUDA Sysmem Fallback: Prefer” 활성화 또는 <code>.env</code>에 {" "}
            <code>LTX_UNET_NAME</code> 지정으로 경량 variant 교체.
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
              onClick={handleGenerate}
              disabled={ctaDisabled}
              style={{
                all: "unset",
                cursor: ctaDisabled ? "not-allowed" : "pointer",
                textAlign: "center",
                background: ctaDisabled ? "var(--accent-disabled)" : "var(--accent)",
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
                if (!ctaDisabled)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--accent-ink)";
              }}
              onMouseLeave={(e) => {
                if (!ctaDisabled)
                  (e.currentTarget as HTMLButtonElement).style.background =
                    "var(--accent)";
              }}
            >
              {running ? (
                // audit P1b: CTA 의 {percent}% 제거 (Edit 과 통일).
                // 상세 진행률은 ProgressModal 이 단일 primary.
                <>
                  <Spinner /> 처리 중…
                </>
              ) : (
                <>
                  <Icon name="sparkle" size={15} />
                  영상 생성
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
              <span className="mono">
                {lightning ? "5~10분" : "25~40분"}
              </span>{" "}
              · 5초 영상 · 로컬 처리
            </div>
          </div>
        </StudioLeftPanel>

        {/* ── RIGHT: 플레이어 + 히스토리 ── */}
        <StudioRightPanel>
          {/* audit R2-8: 공통 StudioResultHeader 로 교체 */}
          <StudioResultHeader title="영상 결과" meta="MP4 · 5s · 25fps" />

          <VideoPlayerCard
            src={playingRef}
            running={running}
            label={pipelineLabel}
            filename={
              playingRef ? filenameFromRef(playingRef, "ais-video.mp4") : undefined
            }
            onExpand={
              // 현재 재생 중 ref 에 해당하는 history item 을 라이트박스에 띄움
              playingRef
                ? () => {
                    const hit = videoResults.find(
                      (v) => v.imageRef === playingRef,
                    );
                    if (hit) setLightboxItem(hit);
                  }
                : undefined
            }
          />

          {/* ── 영상 히스토리 (4 메뉴 공용 헤더) ── */}
          <HistorySectionHeader
            title="영상 히스토리"
            count={videoResults.length}
            actions={
              <IconBtn
                icon="grid"
                title={`그리드 (${gridCols} 컬럼 · 클릭으로 변경)`}
                onClick={cycleGrid}
              />
            }
          />

          <div style={{ maxHeight: "55vh", overflowY: "auto", paddingRight: 4 }}>
            <HistoryGallery
              items={videoResults}
              gridCols={gridCols}
              // selectedId 는 HistoryItem.id 기준 — video 는 playingRef(imageRef) 로 선택 표시.
              // id 매칭으로 바꿔서 HistoryGallery 와 의미를 맞춤.
              selectedId={
                videoResults.find((v) => v.imageRef === playingRef)?.id ?? null
              }
              onTileClick={(it) => {
                // 플레이어에 지정 — 세션 state (lastVideoRef) 로
                useVideoStore.getState().setLastVideoRef(it.imageRef);
              }}
              onTileExpand={(it) => setLightboxItem(it)}
              emptyMessage="아직 생성된 영상이 없습니다."
            />
          </div>

          <div style={{ flex: 1 }} />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}

/* ────────────────────────────────────────────────
   영상 해상도 슬라이더
   - 긴 변을 512~1536 (step 128) 범위로 선택
   - 원본 비율 유지: 예상 출력 해상도 실시간 계산
   - 이미지 없으면 disabled (비율 계산 불가)
   ──────────────────────────────────────────────── */
function VideoResolutionSlider({
  longerEdge,
  setLongerEdge,
  sourceWidth,
  sourceHeight,
}: {
  longerEdge: number;
  setLongerEdge: (v: number) => void;
  sourceWidth: number | null;
  sourceHeight: number | null;
}) {
  const hasSource = !!(sourceWidth && sourceHeight);
  const expected = hasSource
    ? computeVideoResize(sourceWidth!, sourceHeight!, longerEdge)
    : { width: 0, height: 0 };
  // 시간 가중치 — 1536 기준 대비 (픽셀수 제곱 근사)
  const timeFactor = Math.pow(longerEdge / VIDEO_LONGER_EDGE_MAX, 2);
  const speedLabel =
    timeFactor > 0.8
      ? "고품질"
      : timeFactor > 0.4
        ? "표준"
        : timeFactor > 0.18
          ? "빠름"
          : "매우 빠름";
  // 비율 표시 (근사치)
  const ratio = hasSource
    ? simplifyRatio(sourceWidth!, sourceHeight!)
    : "—";

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        opacity: hasSource ? 1 : 0.55,
        transition: "opacity .2s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <label
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}
        >
          영상 해상도
        </label>
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--ink-4)",
            letterSpacing: ".04em",
          }}
        >
          긴 변 {longerEdge}px · {speedLabel}
        </span>
      </div>
      <input
        type="range"
        min={VIDEO_LONGER_EDGE_MIN}
        max={VIDEO_LONGER_EDGE_MAX}
        step={VIDEO_LONGER_EDGE_STEP}
        value={longerEdge}
        disabled={!hasSource}
        onChange={(e) => setLongerEdge(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: "var(--accent)",
          cursor: hasSource ? "pointer" : "not-allowed",
        }}
      />
      {/* 눈금 + 예상 해상도 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--ink-4)",
          marginTop: 2,
        }}
        className="mono"
      >
        <span>{VIDEO_LONGER_EDGE_MIN}</span>
        <span>{VIDEO_LONGER_EDGE_MAX}</span>
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: "var(--ink-3)",
          lineHeight: 1.5,
        }}
      >
        {hasSource ? (
          <>
            원본 <span className="mono">{sourceWidth}×{sourceHeight}</span>
            {" → "}
            출력 <span
              className="mono"
              style={{ color: "var(--accent-ink)", fontWeight: 600 }}
            >
              {expected.width}×{expected.height}
            </span>
            {" "}
            <span style={{ color: "var(--ink-4)" }}>({ratio})</span>
          </>
        ) : (
          "원본 이미지를 업로드하면 예상 출력 해상도가 표시됩니다."
        )}
      </div>
    </div>
  );
}

/** 정수 비율 근사 — "16:9" / "3:4" 등 */
function simplifyRatio(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  return `${w / g}:${h / g}`;
}

