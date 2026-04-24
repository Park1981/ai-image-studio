/**
 * Vision Analyzer Page — 단일 이미지 분석 보조 기능.
 * 2026-04-24 · C5.
 *
 * 레이아웃: 좌 400px (업로드 + [분석] 버튼) / 우 1fr (결과 카드 + 최근 분석 그리드).
 * 생성/수정 페이지와 동일한 Chrome + sticky CTA 스타일 유지.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BackBtn,
  Logo,
  ModelBadge,
  TopBar,
} from "@/components/chrome/Chrome";
import VramBadge from "@/components/chrome/VramBadge";
import SettingsButton from "@/components/settings/SettingsButton";
import SourceImageCard from "@/components/studio/SourceImageCard";
import VisionHistoryList from "@/components/studio/VisionHistoryList";
import VisionResultCard from "@/components/studio/VisionResultCard";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";
import { useVisionPipeline } from "@/hooks/useVisionPipeline";
import { useProcessStore } from "@/stores/useProcessStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import { MAX_VISION_HISTORY, useVisionStore } from "@/stores/useVisionStore";

export default function VisionPage() {
  const router = useRouter();

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

  const visionModel = useSettingsStore((s) => s.visionModel);
  const ollamaStatus = useProcessStore((s) => s.ollama);

  /* ── 갤러리 컬럼 토글 (2/3/4) — Generate/Edit 와 동일 ── */
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /* ── 파이프라인 훅 ── */
  const { analyze, analyzing } = useVisionPipeline();

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
    <div
      style={{
        minHeight: "100vh",
        // 페이지 최소 너비 — 좌 400 + 우 최소 624 = 1024. 그 이하에선 body 가로 스크롤.
        minWidth: 1024,
        display: "flex",
        flexDirection: "column",
      }}
    >
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
            tag="Vision · Ollama"
            status={ollamaStatus === "running" ? "ready" : "loading"}
          />
        }
        right={
          <>
            <VramBadge />
            <SettingsButton />
          </>
        }
      />

      <div
        style={{
          flex: 1,
          display: "grid",
          // 4 페이지 레이아웃 통일 — 좌 400 고정, 우 최소 624.
          gridTemplateColumns: "400px minmax(624px, 1fr)",
          minHeight: "calc(100vh - 52px)",
        }}
      >
        {/* ── LEFT: 업로드 + CTA ── */}
        <section
          style={{
            padding: "24px 20px",
            borderRight: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            background: "var(--bg)",
          }}
        >
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
              borderRadius: 10,
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
                background: analyzeDisabled ? "#B9CEE5" : "var(--accent)",
                color: "#fff",
                padding: "14px 20px",
                borderRadius: 999,
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
        </section>

        {/* ── RIGHT: 결과 카드 + 히스토리 ── */}
        <section
          style={{
            padding: "24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
              분석 결과
            </h3>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                letterSpacing: ".04em",
              }}
            >
              EN + KO
            </span>
          </div>

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
        </section>
      </div>
    </div>
  );
}
