/**
 * Video Page (스텁)
 * 아직 구현 안 됨 — 메뉴에서도 disabled 상태지만, 직접 URL 접근 시 안내 화면
 */

"use client";

import { useRouter } from "next/navigation";
import { Logo, TopBar, BackBtn } from "@/components/chrome/Chrome";
import Icon from "@/components/ui/Icon";
import SettingsButton from "@/components/settings/SettingsButton";

export default function VideoPage() {
  const router = useRouter();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar
        left={
          <>
            <BackBtn onClick={() => router.push("/")} />
            <Logo />
          </>
        }
        right={<SettingsButton />}
      />

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 48px",
          gap: 20,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: "var(--bg-2)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
          }}
        >
          <Icon name="film" size={32} stroke={1.4} />
        </div>
        <div style={{ textAlign: "center", maxWidth: 440 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              letterSpacing: ".18em",
              marginBottom: 10,
              textTransform: "uppercase",
            }}
          >
            준비 중 · v2
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 10px",
            }}
          >
            영상 생성은 곧 만나요
          </h2>
          <p style={{ fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.6, margin: 0 }}>
            이미지 기능이 안정된 뒤 Wan 2.x 기반 Text/Image-to-Video 워크플로우로 돌아올게요.
          </p>
        </div>
      </main>
    </div>
  );
}
