/**
 * Main Menu Page (진입점)
 *
 * 2026-04-24 재구성 — 3카테고리 (이미지 / 비전 / 영상) × 2카드 = 6카드 그리드.
 *  - 이미지: 생성 / 수정
 *  - 비전:   분석 / 비교
 *  - 영상:   생성 / 업스케일(준비 중)
 *
 * 2026-04-26 헤더 통합 + 풋터 리디자인.
 *   - <AppHeader /> 한 줄로 헤더 흡수 (라우트 자동 분기 / SystemMetrics 4-bar).
 *   - 하단 스트립 (VramBadge / 최근 생성) 제거 → 멋스러운 카피라이트 풋터.
 */

"use client";

import { useRouter } from "next/navigation";
import AppHeader from "@/components/chrome/AppHeader";
import MenuCard from "@/components/menu/MenuCard";
import { useHistoryStore } from "@/stores/useHistoryStore";

/** 카테고리 섹션 래퍼 — 옅은 배경 박스 + 디스플레이 헤더 */
function CategorySection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-xl)",
        padding: "20px 18px 22px",
      }}
    >
      <div
        className="display"
        style={{
          fontSize: 24,
          color: "var(--ink)",
          letterSpacing: 0,
          fontWeight: 620,
          lineHeight: 1.1,
          fontVariationSettings: '"opsz" 72, "SOFT" 42, "WONK" 0',
          paddingLeft: 4,
          paddingBottom: 2,
        }}
      >
        {label}
      </div>
      {children}
    </section>
  );
}

export default function MainMenuPage() {
  const router = useRouter();
  const historyCount = useHistoryStore((s) => s.items.length);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppHeader />

      {/* 메인 콘텐츠 — 1154px viewport 풋터 fully 보이게 다이어트 (2026-04-26) */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "24px 48px",
          maxWidth: 1280,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {/* 인사말 */}
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              margin: 0,
              color: "var(--ink)",
            }}
          >
            AI Image Studio
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              marginTop: 8,
              marginBottom: 0,
              letterSpacing: 0,
            }}
          >
            자연어로 시작하는 로컬 이미지 생성 워크스페이스
          </p>
        </div>

        {/* 3카테고리 그리드 — 열당 카드 2장 세로 스택.
            반응형 baseline (2026-04-26 P0-1):
              ≥1280px: 3열 (기본 데스크톱 인상 유지)
              1024-1280px: 2열 (13인치 노트북 등 좁은 데스크톱)
              <1024px: 미지원 (StudioLayout 과 동일 floor) */}
        <div
          className="ais-menu-grid"
          style={{
            display: "grid",
            gap: 28,
          }}
        >
          {/* ── 이미지 카테고리 ── */}
          <CategorySection label="Image">
            <MenuCard
              icon="image"
              title="Image Generate"
              desc="자연어 프롬프트를 gemma4로 업그레이드한 뒤 ComfyUI 워크플로우에 전달합니다."
              bgImage="/menu/generate.png"
              onClick={() => router.push("/generate")}
            />
            <MenuCard
              icon="wand"
              title="Image Edit"
              desc="참조 이미지와 자연어 지시를 비전 모델로 분석해 수정본을 생성합니다."
              bgImage="/menu/edit.png"
              onClick={() => router.push("/edit")}
            />
          </CategorySection>

          {/* ── 비전 카테고리 ── */}
          <CategorySection label="Vision">
            <MenuCard
              icon="scan-eye"
              title="Vision Analyze"
              desc="이미지 한 장을 비전 모델로 분석해 상세 영/한 설명을 추출합니다."
              bgImage="/menu/vision.png"
              onClick={() => router.push("/vision")}
            />
            <MenuCard
              icon="compare"
              title="Vision Compare"
              desc="두 이미지를 비전 모델로 깊이 관찰해 공통점·차이점·5 카테고리 비교를 자세히 분석합니다."
              bgImage="/menu/compare.png"
              onClick={() => router.push("/vision/compare")}
            />
          </CategorySection>

          {/* ── 영상 카테고리 ── */}
          <CategorySection label="Video">
            <MenuCard
              icon="play"
              title="Video Generate"
              desc="이미지 한 장에서 LTX-2.3 로 5초 · 25fps 오디오+영상 MP4 를 생성합니다."
              bgImage="/menu/video.png"
              onClick={() => router.push("/video")}
            />
            <MenuCard
              icon="upscale"
              title="Video Upscale"
              desc="LTX-2.3 공간 업스케일러로 영상 해상도를 2배로 향상합니다."
              bgImage="/menu/upscale.png"
              disabled
            />
          </CategorySection>

          {/* ── 실험실 카테고리 (Lab) ── 2026-05-15 추가.
              Plan A 완료된 Sulphur 기반 video lab 진입점.
              향후 image-lab 등 다른 실험 모드도 이 섹션에 누적된다. */}
          <CategorySection label="Lab">
            <MenuCard
              icon="flame"
              title="Video Lab · Sulphur"
              desc="Sulphur LoRA + LTX-2.3 distilled 조합을 실험합니다. 정식 영상 모드와 분리된 실험 워크스페이스."
              hue="#FFEFE0"
              onClick={() => router.push("/lab/video")}
            />
          </CategorySection>
        </div>
      </main>

      {/*
        멋스러운 카피라이트 풋터 (2026-04-26 신설).
          line 1: 제품명 + 에디션 — 대문자 letter-spacing 넓게
          line 2: © 카피라이트 + 버전 + 누적 생성 횟수 — mono
          line 3: 빌드 스택 — 매우 옅은 mono
        SystemMetrics 가 헤더로 옮겨서 더 이상 하단에 자원 정보 표시 안 함.
      */}
      <AppFooter historyCount={historyCount} />
    </div>
  );
}

/* ─────────────────────────────────────────
   AppFooter — 메인 페이지 풋터
   ───────────────────────────────────────── */
function AppFooter({ historyCount }: { historyCount: number }) {
  // 누적 생성 표기 (영문 자연스러움 위해 단/복수 구분)
  const generationsLabel =
    historyCount === 0
      ? "ready to generate"
      : `${historyCount} generation${historyCount === 1 ? "" : "s"}`;

  return (
    <footer
      style={{
        marginTop: 16,
        paddingTop: 18,
        paddingBottom: 22,
        // 옅은 hairline + 위로 옅은 fade 그라데이션 (디자인 디테일)
        borderTop: "1px solid var(--line)",
        background:
          "linear-gradient(to bottom, transparent 0%, var(--bg-2) 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        textAlign: "center",
      }}
    >
      {/* Line 1: 제품명 + 카피라이트 + 버전 + 생성 횟수 (2026-04-26 2줄로 압축) */}
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--ink-3)",
          letterSpacing: ".18em",
          textTransform: "uppercase",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <span>AI Image Studio · Local Edition</span>
        <span style={{ color: "var(--ink-4)", fontWeight: 500, letterSpacing: ".1em" }}>
          © 2026 · v1.2.4 · {generationsLabel}
        </span>
      </div>

      {/* Line 2: 빌드 스택 — 매우 옅게 */}
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--ink-4)",
          letterSpacing: ".05em",
          opacity: 0.65,
        }}
      >
        Crafted with Next.js · FastAPI · ComfyUI · gemma4 · qwen-image · LTX-2.3
      </div>
    </footer>
  );
}
