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

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Logo, TopBar, BackBtn } from "@/components/chrome/Chrome";
import VramBadge from "@/components/chrome/VramBadge";
import SettingsButton from "@/components/settings/SettingsButton";
import Icon from "@/components/ui/Icon";
import BeforeAfterSlider from "@/components/studio/BeforeAfterSlider";
import {
  useVisionCompareStore,
  type VisionCompareImage,
} from "@/stores/useVisionCompareStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProcessStore } from "@/stores/useProcessStore";
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

  const visionModel = useSettingsStore((s) => s.visionModel);
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const ollamaOn = useProcessStore((s) => s.ollama) === "running";

  /* ── 분석 실행 ── */
  const runAnalyze = async () => {
    if (!imageA || !imageB || running) return;
    if (!ollamaOn) {
      toast.warn("Ollama 정지", "설정에서 Ollama 를 시작해 주세요.");
      return;
    }

    setRunning(true);
    setAnalysis(null);

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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar
        left={
          <>
            <BackBtn onClick={() => router.push("/")} />
            <Logo />
          </>
        }
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <VramBadge />
            <SettingsButton />
          </div>
        }
      />

      <main
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "400px minmax(624px, 1fr)",
          gap: 24,
          padding: "24px 32px 32px",
          maxWidth: 1600,
          width: "100%",
          margin: "0 auto",
          minWidth: 1024,
        }}
      >
        {/* ───────── 좌 패널 (입력) ───────── */}
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            position: "relative",
          }}
        >
          <PageTitle />

          {/* 이미지 A 슬롯 */}
          <ImageSlot
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
          <ImageSlot
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
                  padding: "12px 14px",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "var(--ink)",
                  borderRadius: 12,
                  minHeight: 76,
                }}
              />
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
        </aside>

        {/* ───────── 우 패널 (뷰어 + 결과) ───────── */}
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            minWidth: 0,
          }}
        >
          {/* 상단 뷰어 — /edit 와 동일한 자연 높이 (BeforeAfterSlider 의 기본 maxHeight 70vh) */}
          <ViewerPanel
            imageA={imageA}
            imageB={imageB}
            mode={viewerMode}
            onModeChange={setViewerMode}
          />

          {/* 하단 분석 결과 카드 — 콘텐츠 높이 만큼 */}
          <AnalysisPanel running={running} analysis={analysis} />
        </section>
      </main>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * 페이지 타이틀 (좌 패널 상단)
 * ──────────────────────────────────────────────────────────────────── */
function PageTitle() {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        className="display"
        style={{
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          color: "var(--ink)",
          textTransform: "uppercase",
          lineHeight: 1.1,
        }}
      >
        Vision Compare
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
        두 이미지를 비전 모델로 5축 비교 (구성·색감·피사체·분위기·품질)
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * 컴팩트 이미지 업로드 슬롯 (좌 패널용)
 * ──────────────────────────────────────────────────────────────────── */
function ImageSlot({
  label,
  badge,
  value,
  onChange,
  onClear,
}: {
  label: string;
  badge: "A" | "B";
  value: VisionCompareImage | null;
  onChange: (img: VisionCompareImage) => void;
  onClear: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드 가능합니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        onChange({
          dataUrl,
          label: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => toast.error("이미지 로드 실패");
      img.src = dataUrl;
    };
    reader.onerror = () => toast.error("파일 읽기 실패");
    reader.readAsDataURL(file);
  };

  if (!value) {
    return (
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        style={{
          minHeight: 140,
          border: "1.5px dashed var(--line-2)",
          borderRadius: 12,
          background: "var(--bg-2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          cursor: "pointer",
          color: "var(--ink-3)",
          fontSize: 12,
          padding: "16px 12px",
          transition: "all .15s",
        }}
      >
        <SlotBadge>{badge}</SlotBadge>
        <Icon name="upload" size={20} />
        <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>{label}</div>
        <div style={{ fontSize: 11 }}>클릭 또는 드래그로 업로드</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        minHeight: 140,
        borderRadius: 12,
        // 검은 배경 제거 — warm neutral 로 통일
        background: "var(--bg-2)",
        overflow: "hidden",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={value.dataUrl}
        alt={label}
        style={{
          width: "100%",
          height: 160,
          objectFit: "contain",
          display: "block",
        }}
      />
      <SlotBadge floating>{badge}</SlotBadge>
      {/* 우상단 액션 — 변경 / 해제 */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          display: "flex",
          gap: 6,
        }}
      >
        <ActionPill
          onClick={() => fileInputRef.current?.click()}
          title="이미지 변경"
        >
          <Icon name="refresh" size={11} /> 변경
        </ActionPill>
        <ActionPill onClick={onClear} title="해제">
          <Icon name="x" size={11} />
        </ActionPill>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {/* 좌하단 메타 */}
      <div
        style={{
          position: "absolute",
          bottom: 6,
          left: 8,
          fontSize: 10,
          color: "rgba(255,255,255,.85)",
          background: "rgba(0,0,0,.5)",
          padding: "2px 6px",
          borderRadius: 4,
          backdropFilter: "blur(4px)",
        }}
        className="mono"
      >
        {value.width}×{value.height}
      </div>
    </div>
  );
}

function SlotBadge({
  children,
  floating,
}: {
  children: React.ReactNode;
  floating?: boolean;
}) {
  if (floating) {
    return (
      <div
        className="display"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          width: 26,
          height: 26,
          borderRadius: 8,
          background: "rgba(255,255,255,.92)",
          color: "var(--ink)",
          display: "grid",
          placeItems: "center",
          fontSize: 13,
          fontWeight: 600,
          boxShadow: "0 2px 6px rgba(0,0,0,.2)",
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className="display"
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--ink-2)",
      }}
    >
      {children}
    </div>
  );
}

function ActionPill({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        background: "rgba(0,0,0,.55)",
        backdropFilter: "blur(6px)",
        color: "#fff",
        fontSize: 11,
        borderRadius: 999,
      }}
    >
      {children}
    </button>
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
        minHeight: 0,
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
        <ModeToggle mode={mode} onChange={onModeChange} disabled={!both} />
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

function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: "slider" | "sidebyside";
  onChange: (m: "slider" | "sidebyside") => void;
  disabled: boolean;
}) {
  const opts: Array<{ key: "slider" | "sidebyside"; label: string }> = [
    { key: "slider", label: "↔ 슬라이더" },
    { key: "sidebyside", label: "◫ 나란히" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: 999,
        padding: 2,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          style={{
            all: "unset",
            cursor: disabled ? "not-allowed" : "pointer",
            padding: "5px 12px",
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 999,
            background: mode === o.key ? "var(--surface)" : "transparent",
            color: mode === o.key ? "var(--ink)" : "var(--ink-3)",
            boxShadow: mode === o.key ? "var(--shadow-sm)" : "none",
            transition: "all .15s",
          }}
        >
          {o.label}
        </button>
      ))}
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
  // 두 이미지 비율 평균을 박스 aspectRatio 로 사용 (/edit 의 70vh 패턴과 비슷한 자연 높이)
  const ratioA = imageA.width / imageA.height;
  const ratioB = imageB.width / imageB.height;
  // 가로 두 박스라 합산 가로 = 2 × max-side · 평균 비율로 박스 높이 결정
  const avgRatio = (ratioA + ratioB) / 2;
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
      <SlotBadge floating>{badge}</SlotBadge>
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
        minHeight: 0,
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
