/**
 * Main Menu Page (진입점)
 * 카드 4장: 이미지 생성 / 이미지 수정 / Vision 분석 / 영상 생성(준비 중)
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
        <div style={{ marginBottom: 48, textAlign: "center" }}>
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

        {/* 카드 4장 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 20,
          }}
        >
          <MenuCard
            icon="image"
            title="이미지 생성"
            desc="자연어 프롬프트를 gemma4로 업그레이드한 뒤 ComfyUI 워크플로우에 전달합니다."
            hue="#EAF3FF"
            onClick={() => router.push("/generate")}
          />
          <MenuCard
            icon="edit"
            title="이미지 수정"
            desc="참조 이미지와 자연어 지시를 비전 모델로 분석해 수정본을 생성합니다."
            hue="#EEF9E4"
            onClick={() => router.push("/edit")}
          />
          <MenuCard
            icon="search"
            title="Vision 분석"
            desc="이미지 한 장을 비전 모델로 분석해 상세 영/한 설명을 추출합니다. 생성 프롬프트로 복사해 쓸 수 있어요."
            hue="#FFF3E0"
            tag="보조 기능"
            onClick={() => router.push("/vision")}
          />
          <MenuCard
            icon="film"
            title="영상 생성"
            desc="이미지 또는 프롬프트로부터 짧은 클립을 생성합니다. 다음 버전에서 제공됩니다."
            tag="준비 중 · v2"
            disabled
            onClick={() => router.push("/video")}
          />
        </div>

        {/* 하단 스트립 */}
        <div
          style={{
            marginTop: 48,
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
