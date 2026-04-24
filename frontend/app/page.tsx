/**
 * Main Menu Page (진입점)
 *
 * 2026-04-24 재구성 — 3카테고리 (이미지 / 비전 / 영상) × 2카드 = 6카드 그리드.
 *  - 이미지: 생성 / 수정
 *  - 비전:   분석 / 비교(준비 중)
 *  - 영상:   생성 / 업스케일(준비 중)
 */

"use client";

import { useRouter } from "next/navigation";
import { Logo, TopBar } from "@/components/chrome/Chrome";
import VramBadge from "@/components/chrome/VramBadge";
import MenuCard from "@/components/menu/MenuCard";
import Icon from "@/components/ui/Icon";
import SettingsButton from "@/components/settings/SettingsButton";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";

/** 카테고리 섹션 래퍼 — 옅은 배경 박스 + Unbounded 디스플레이 헤더 */
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
        borderRadius: 20,
        padding: "20px 18px 22px",
      }}
    >
      <div
        className="display"
        style={{
          fontSize: 24,
          color: "var(--ink)",
          letterSpacing: "-0.005em",
          textTransform: "uppercase",
          fontWeight: 500,
          lineHeight: 1.1,
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
  const comfyuiStatus = useProcessStore((s) => s.comfyui);
  const comfyuiOn = comfyuiStatus === "running";

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar left={<Logo />} right={<SettingsButton />} />

      {/* 메인 콘텐츠 */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "40px 48px",
          maxWidth: 1280,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {/* 인사말 + 상태 스트립 */}
        <div style={{ marginBottom: 44, textAlign: "center" }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              letterSpacing: ".18em",
              marginBottom: 14,
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: comfyuiOn ? "var(--green)" : "var(--ink-4)",
                marginRight: 8,
                verticalAlign: "middle",
                boxShadow: comfyuiOn
                  ? "0 0 0 3px rgba(82,196,26,.15)"
                  : "none",
              }}
            />
            Local Runtime · ComfyUI {comfyuiOn ? "연결됨" : "정지"}
          </div>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              margin: 0,
              color: "var(--ink)",
            }}
          >
            어떤 걸 만들까요?
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--ink-3)",
              marginTop: 10,
              marginBottom: 0,
              letterSpacing: "-0.005em",
            }}
          >
            자연어로 시작하는 로컬 이미지 생성 워크스페이스
          </p>
        </div>

        {/* 3카테고리 그리드 — 열당 카드 2장 세로 스택 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 28,
          }}
        >
          {/* ── 이미지 카테고리 ── */}
          <CategorySection label="Image">
            <MenuCard
              icon="image"
              title="이미지 생성"
              desc="자연어 프롬프트를 gemma4로 업그레이드한 뒤 ComfyUI 워크플로우에 전달합니다."
              bgImage="/menu/generate.png"
              onClick={() => router.push("/generate")}
            />
            <MenuCard
              icon="edit"
              title="이미지 수정"
              desc="참조 이미지와 자연어 지시를 비전 모델로 분석해 수정본을 생성합니다."
              bgImage="/menu/edit.png"
              onClick={() => router.push("/edit")}
            />
          </CategorySection>

          {/* ── 비전 카테고리 ── */}
          <CategorySection label="Vision">
            <MenuCard
              icon="search"
              title="비전 분석"
              desc="이미지 한 장을 비전 모델로 분석해 상세 영/한 설명을 추출합니다."
              bgImage="/menu/vision.png"
              onClick={() => router.push("/vision")}
            />
            <MenuCard
              icon="grid"
              title="비전 비교"
              desc="두 이미지를 비전 모델로 비교해 구성·색·피사체·분위기·품질 5축 차이를 분석합니다."
              bgImage="/menu/compare.png"
              tag="NEW"
              onClick={() => router.push("/vision/compare")}
            />
          </CategorySection>

          {/* ── 영상 카테고리 ── */}
          <CategorySection label="Video">
            <MenuCard
              icon="play"
              title="영상 생성"
              desc="이미지 한 장에서 LTX-2.3 로 5초 · 25fps 오디오+영상 MP4 를 생성합니다."
              bgImage="/menu/video.png"
              tag="LTX-2.3"
              onClick={() => router.push("/video")}
            />
            <MenuCard
              icon="upscale"
              title="영상 업스케일"
              desc="LTX-2.3 공간 업스케일러로 영상 해상도를 2배로 향상합니다."
              bgImage="/menu/upscale.png"
              tag="준비 중"
              disabled
            />
          </CategorySection>
        </div>

        {/* 하단 스트립 */}
        <div
          style={{
            marginTop: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 4px",
            borderTop: "1px solid var(--line)",
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="gear" size={13} />
              <span>설정에서 모델·저장 경로를 바꿀 수 있어요</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="clock" size={13} />
              최근 생성:{" "}
              <strong style={{ color: "var(--ink-2)", fontWeight: 600 }}>
                {historyCount}장
              </strong>
            </span>
            <VramBadge />
          </div>
        </div>
      </main>
    </div>
  );
}
