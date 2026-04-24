/**
 * /vision/compare — 비전 비교 메뉴 (사용자가 임의로 고른 두 이미지 5축 비교).
 * 2026-04-24 신설.
 *
 * 레이아웃:
 *   400px 좌 패널 (2슬롯 업로드 + 스왑 + 비교 지시 + sticky CTA)
 *   1fr 우 패널 (상단 62% 뷰어 + 하단 38% 5축 분석 결과)
 *
 * 데이터:
 *   - useVisionCompareStore (완전 휘발 · DB 저장 X · 페이지 떠나면 모두 사라짐)
 *   - 비전 모델은 useSettingsStore.visionModel (설정 드로어 공용 · 페이지에 노출 X)
 *
 * 백엔드:
 *   - POST /api/studio/compare-analyze · meta.context="compare"
 *   - analyze_pair_generic 호출 (Edit 코드 경로 무영향)
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo, TopBar, BackBtn, ModelBadge } from "@/components/chrome/Chrome";
import VramBadge from "@/components/chrome/VramBadge";
import SettingsButton from "@/components/settings/SettingsButton";
import Icon from "@/components/ui/Icon";
import BeforeAfterSlider from "@/components/studio/BeforeAfterSlider";
import AnalysisProgressModal from "@/components/studio/AnalysisProgressModal";
import {
  CompareImageSlot,
  CompareSlotBadge,
} from "@/components/studio/CompareImageSlot";
import {
  StudioLeftPanel,
  StudioModeHeader,
  StudioPage,
  StudioRightPanel,
  StudioWorkspace,
} from "@/components/studio/StudioLayout";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import { SegControl } from "@/components/ui/primitives";
import {
  useVisionCompareStore,
  type VisionCompareImage,
} from "@/stores/useVisionCompareStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";
import { compareAnalyze } from "@/lib/api-client";
import { toast } from "@/stores/useToastStore";
import type { VisionCompareAnalysis } from "@/lib/api/types";

/* ──────────────────────────────────────────────────────────────────────
 * Vision Compare 5축 한국어 라벨
 * ──────────────────────────────────────────────────────────────────── */
const AXIS_LABELS_KO: Record<keyof VisionCompareAnalysis["scores"], string> = {
  composition: "구성",
  color: "색감",
  subject: "피사체",
  mood: "분위기",
  quality: "품질",
};

const AXIS_ORDER: Array<keyof VisionCompareAnalysis["scores"]> = [
  "composition",
  "color",
  "subject",
  "mood",
  "quality",
];

/* ──────────────────────────────────────────────────────────────────────
 * 페이지
 * ──────────────────────────────────────────────────────────────────── */
export default function VisionComparePage() {
  const router = useRouter();
  const imageA = useVisionCompareStore((s) => s.imageA);
  const imageB = useVisionCompareStore((s) => s.imageB);
  const hint = useVisionCompareStore((s) => s.hint);
  const running = useVisionCompareStore((s) => s.running);
  const analysis = useVisionCompareStore((s) => s.analysis);
  const viewerMode = useVisionCompareStore((s) => s.viewerMode);
  const setImageA = useVisionCompareStore((s) => s.setImageA);
  const setImageB = useVisionCompareStore((s) => s.setImageB);
  const swapImages = useVisionCompareStore((s) => s.swapImages);
  const setHint = useVisionCompareStore((s) => s.setHint);
  const setRunning = useVisionCompareStore((s) => s.setRunning);
  const setAnalysis = useVisionCompareStore((s) => s.setAnalysis);
  const setViewerMode = useVisionCompareStore((s) => s.setViewerMode);
  const addPromptHistory = usePromptHistoryStore((s) => s.add);

  const visionModel = useSettingsStore((s) => s.visionModel);
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const ollamaOn = useProcessStore((s) => s.ollama) === "running";

  useEffect(() => {
    setHint("");
  }, [setHint]);

  /* ── 진행 모달 open 상태 ── */
  const [progressOpen, setProgressOpen] = useState(false);
  const [prevRunning, setPrevRunning] = useState(running);
  if (prevRunning !== running) {
    setPrevRunning(running);
    if (running) setProgressOpen(true);
  }

  useEffect(() => {
    if (running) return;
    if (!progressOpen) return;
    const t = setTimeout(() => setProgressOpen(false), 1000);
    return () => clearTimeout(t);
  }, [running, progressOpen]);

  /* ── 분석 실행 ── */
  const runAnalyze = async () => {
    if (!imageA || !imageB || running) return;
    if (!ollamaOn) {
      toast.warn("Ollama 정지", "설정에서 Ollama 를 시작해 주세요.");
      return;
    }

    setRunning(true);
    setAnalysis(null);
    addPromptHistory("compare", hint);

    try {
      const { analysis: rawAnalysis } = await compareAnalyze({
        source: imageA.dataUrl, // IMAGE_A
        result: imageB.dataUrl, // IMAGE_B
        editPrompt: "", // compare context 에선 사용 X
        context: "compare",
        compareHint: hint,
        visionModel,
        ollamaModel,
        // historyItemId 미전송 → 백엔드가 DB 저장 자동 스킵 = 완전 휘발 보장
      });

      // compare context 응답은 VisionCompareAnalysis 5축
      const a = rawAnalysis as VisionCompareAnalysis;
      setAnalysis(a);

      if (a.fallback) {
        toast.warn("비교 분석 fallback", a.summary_ko || "비전 응답 부족");
      } else {
        toast.success("비교 분석 완료", `종합 ${a.overall}%`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("비교 분석 실패", msg);
    } finally {
      setRunning(false);
    }
  };

  const canRun = !!imageA && !!imageB && !running;

  return (
    <StudioPage>
      {progressOpen && (
        <AnalysisProgressModal
          mode="compare"
          running={running}
          onClose={() => setProgressOpen(false)}
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
            name={visionModel || "vision"}
            tag="Compare · Ollama"
            status={ollamaOn ? "ready" : "loading"}
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
        {/* ───────── 좌 패널 (입력) ───────── */}
        <StudioLeftPanel>
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
                borderRadius: 999,
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

          {/* 비교 지시 (선택) — /edit 의 프롬프트 입력 박스 스타일 통일 */}
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
                <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>
                  (선택)
                </span>
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
                borderRadius: 12,
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
                  borderRadius: 12,
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
                    borderRadius: 6,
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
              onClick={runAnalyze}
              disabled={!canRun}
              style={{
                all: "unset",
                cursor: canRun ? "pointer" : "not-allowed",
                textAlign: "center",
                background: canRun ? "var(--accent)" : "#B9CEE5",
                color: "#fff",
                padding: "14px 20px",
                borderRadius: 999,
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
        </StudioLeftPanel>

        {/* ───────── 우 패널 (뷰어 + 결과) ───────── */}
        <StudioRightPanel>
          {/* 상단 뷰어 — /edit 와 동일한 자연 높이 (BeforeAfterSlider 의 기본 maxHeight 70vh) */}
          <ViewerPanel
            imageA={imageA}
            imageB={imageB}
            mode={viewerMode}
            onModeChange={setViewerMode}
          />

          {/* 하단 분석 결과 카드 — 콘텐츠 높이 만큼 */}
          <AnalysisPanel running={running} analysis={analysis} />
        </StudioRightPanel>
      </StudioWorkspace>
    </StudioPage>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * 우 상단 뷰어 패널 — 토글 + 슬라이더/나란히
 * ──────────────────────────────────────────────────────────────────── */
function ViewerPanel({
  imageA,
  imageB,
  mode,
  onModeChange,
}: {
  imageA: VisionCompareImage | null;
  imageB: VisionCompareImage | null;
  mode: "slider" | "sidebyside";
  onModeChange: (m: "slider" | "sidebyside") => void;
}) {
  const both = !!imageA && !!imageB;

  // 비율 차이 감지 — 10% 이상 다르면 슬라이더 비추천 (사용자에게만 안내)
  const ratioDiverges =
    both &&
    imageA &&
    imageB &&
    Math.abs(imageA.width / imageA.height - imageB.width / imageB.height) /
      (imageA.width / imageA.height) >
      0.1;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 304,
      }}
    >
      {/* 헤더 + 모드 토글 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink-2)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="zoom-in" size={13} />
          비교 뷰어
          {ratioDiverges && mode === "slider" && (
            <span
              style={{
                fontSize: 10,
                color: "var(--amber-ink)",
                fontWeight: 500,
                background: "var(--amber-soft)",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              비율이 달라요 — 나란히 권장
            </span>
          )}
        </div>
        <SegControl
          disabled={!both}
          value={mode}
          onChange={(v) => onModeChange(v as "slider" | "sidebyside")}
          options={[
            { value: "slider", label: "슬라이더" },
            { value: "sidebyside", label: "나란히" },
          ]}
        />
      </div>

      {/* 본문 */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {!both ? (
          <EmptyViewer />
        ) : mode === "slider" ? (
          <SliderViewer imageA={imageA!} imageB={imageB!} />
        ) : (
          <SideBySideViewer imageA={imageA!} imageB={imageB!} />
        )}
      </div>
    </div>
  );
}

function EmptyViewer() {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--bg-2)",
        border: "1.5px dashed var(--line-2)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "var(--ink-3)",
      }}
    >
      <Icon name="image" size={28} />
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
        이미지 A 와 B 를 모두 업로드하면 비교가 시작됩니다
      </div>
      <div style={{ fontSize: 11 }}>좌측 패널에서 두 슬롯을 채워 주세요</div>
    </div>
  );
}

function SliderViewer({
  imageA,
  imageB,
}: {
  imageA: VisionCompareImage;
  imageB: VisionCompareImage;
}) {
  // 비율은 A 기준 (B 는 contain 으로 박스 안에서 알아서 맞춰짐)
  // /edit 패턴: 바깥 flex center + 안쪽 BeforeAfterSlider · maxHeight 기본 70vh
  const aspect = `${imageA.width} / ${imageA.height}`;
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <div style={{ position: "relative" }}>
        <BeforeAfterSlider
          beforeSrc={imageA.dataUrl}
          afterSeed="vision-compare"
          afterSrc={imageB.dataUrl}
          aspectRatio={aspect}
          beforeLabel="A"
          afterLabel="B"
        />
      </div>
    </div>
  );
}

function SideBySideViewer({
  imageA,
  imageB,
}: {
  imageA: VisionCompareImage;
  imageB: VisionCompareImage;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        // 가로 두 칸이라 박스 한 개당 가로 = 절반 → aspectRatio 로 높이 자동
        // 전체 컨테이너에 maxHeight 70vh 보장 (편집 페이지와 동일)
        maxHeight: "70vh",
      }}
    >
      <SideThumb img={imageA} badge="A" aspectRatio={`${imageA.width} / ${imageA.height}`} />
      <SideThumb img={imageB} badge="B" aspectRatio={`${imageB.width} / ${imageB.height}`} />
    </div>
  );
}

function SideThumb({
  img,
  badge,
  aspectRatio,
}: {
  img: VisionCompareImage;
  badge: "A" | "B";
  aspectRatio: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        // 검은 배경 제거 — warm neutral 로 변경 (이미지 contain 시 여백이 자연스럽게 어울림)
        background: "var(--bg-2)",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        aspectRatio,
        maxHeight: "70vh",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={img.dataUrl}
        alt={badge}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
      <CompareSlotBadge floating>{badge}</CompareSlotBadge>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * 우 하단 분석 결과 패널
 * ──────────────────────────────────────────────────────────────────── */
function AnalysisPanel({
  running,
  analysis,
}: {
  running: boolean;
  analysis: VisionCompareAnalysis | null;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 262,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink-2)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="grid" size={13} />
          5축 비교 분석
        </div>
        {analysis && !analysis.fallback && (
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              padding: "3px 8px",
              background: "var(--bg-2)",
              borderRadius: 999,
            }}
          >
            종합 {analysis.overall}%
          </div>
        )}
      </div>

      {/* 본문 분기 */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {running ? (
          <AnalysisLoading />
        ) : !analysis ? (
          <AnalysisEmpty />
        ) : analysis.fallback ? (
          <AnalysisFallback summary={analysis.summary_ko} />
        ) : (
          <AnalysisFilled analysis={analysis} />
        )}
      </div>
    </div>
  );
}

function AnalysisLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        height: "100%",
        color: "var(--ink-3)",
        fontSize: 12,
      }}
    >
      <Icon name="refresh" size={20} className="spin" />
      qwen2.5vl 이 두 이미지를 비교하는 중입니다 · 5~10초 소요
    </div>
  );
}

function AnalysisEmpty() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: "100%",
        color: "var(--ink-3)",
        fontSize: 12,
      }}
    >
      <Icon name="sparkle" size={18} />
      <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>
        분석 대기 중
      </div>
      <div>두 이미지 업로드 후 좌측의 비교 분석 시작 을 눌러 주세요</div>
    </div>
  );
}

function AnalysisFallback({ summary }: { summary: string }) {
  return (
    <div
      style={{
        background: "var(--amber-soft)",
        border: "1px solid var(--amber)",
        borderRadius: 10,
        padding: "12px 14px",
        fontSize: 12,
        color: "var(--amber-ink)",
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>분석 부분 실패</div>
      {summary || "비전 모델 응답을 파싱하지 못했습니다."}
    </div>
  );
}

function AnalysisFilled({ analysis }: { analysis: VisionCompareAnalysis }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 5축 막대 + 코멘트 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {AXIS_ORDER.map((axis) => (
          <AxisRow
            key={axis}
            label={AXIS_LABELS_KO[axis]}
            score={analysis.scores[axis]}
            comment={analysis.comments_ko[axis] || analysis.comments_en[axis]}
          />
        ))}
      </div>

      {/* 총평 */}
      {analysis.summary_ko && (
        <div
          style={{
            background: "var(--bg-2)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: ".15em",
              textTransform: "uppercase",
              marginBottom: 4,
              fontWeight: 600,
            }}
          >
            Summary
          </div>
          {analysis.summary_ko}
        </div>
      )}
    </div>
  );
}

function AxisRow({
  label,
  score,
  comment,
}: {
  label: string;
  score: number | null;
  comment: string;
}) {
  const pct = score ?? 0;
  // 점수 색상 — 80+ 초록, 60+ 앰버, 그 미만 회색
  const barColor =
    score === null
      ? "var(--ink-4)"
      : score >= 80
        ? "var(--green)"
        : score >= 60
          ? "var(--amber)"
          : "var(--ink-3)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>{label}</span>
        <span
          className="mono"
          style={{
            color: score === null ? "var(--ink-4)" : "var(--ink-2)",
            fontWeight: 600,
          }}
        >
          {score === null ? "—" : `${score}%`}
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: "var(--bg-2)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: barColor,
            transition: "width .35s ease",
          }}
        />
      </div>
      {comment && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--ink-3)",
            lineHeight: 1.5,
            paddingLeft: 2,
          }}
        >
          {comment}
        </div>
      )}
    </div>
  );
}
