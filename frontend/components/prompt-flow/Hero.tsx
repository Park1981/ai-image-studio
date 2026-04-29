/**
 * Prompt Flow Hero — 메뉴 카드와 동일 배경 이미지 + 그라디언트 + 흐름 라벨.
 *
 * 메인 메뉴(MenuCard)의 배경 톤을 도움말 페이지 hero 영역에 재사용하여
 * 시각적 일관성을 확보합니다.
 */

"use client";

import type { FlowMode, ModeMeta } from "@/lib/prompt-flow-content";

const ACCENT_TO_VAR: Record<string, string> = {
  blue: "var(--accent)",
  green: "var(--green)",
  amber: "var(--amber)",
};

const ACCENT_TO_INK: Record<string, string> = {
  blue: "var(--accent-ink)",
  green: "var(--green-ink)",
  amber: "var(--amber-ink)",
};

export default function Hero({
  meta,
  mode,
}: {
  meta: ModeMeta;
  mode: FlowMode;
}) {
  const accentColor = ACCENT_TO_VAR[meta.heroAccent] ?? "var(--accent)";
  const accentInk = ACCENT_TO_INK[meta.heroAccent] ?? "var(--accent-ink)";

  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        minHeight: 320,
        borderRadius: "var(--radius-xl)",
        overflow: "hidden",
        background: "#0c0c10",
        boxShadow: "var(--shadow-md)",
      }}
    >
      {/* 배경 이미지 — 메뉴 카드와 동일 자산 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={meta.heroBg}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "brightness(0.78) saturate(1.03)",
        }}
      />

      {/* 좌측 → 우측 어둡게 그라디언트 (텍스트 가독성) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(105deg, rgba(10,12,16,.74) 0%, rgba(10,12,16,.55) 45%, rgba(10,12,16,.18) 100%)",
        }}
      />

      {/* 텍스트 + 흐름 라벨 */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "40px 36px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minHeight: 320,
          justifyContent: "flex-end",
          color: "#FFFFFF",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignSelf: "flex-start",
            alignItems: "center",
            gap: 8,
            padding: "5px 12px",
            borderRadius: "var(--radius-full)",
            background: "rgba(255,255,255,.18)",
            border: `1px solid ${accentColor}`,
            color: "#FFFFFF",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".18em",
            backdropFilter: "blur(6px)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accentColor,
            }}
          />
          PROMPT FLOW · {mode.toUpperCase()}
        </div>

        <h1
          className="display"
          style={{
            margin: 0,
            fontSize: 36,
            fontWeight: 660,
            lineHeight: 1.08,
            letterSpacing: "-0.01em",
            color: "#FFFFFF",
            fontVariationSettings: '"opsz" 72, "SOFT" 42, "WONK" 0',
          }}
        >
          {meta.title}
        </h1>

        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.55,
            color: "rgba(255,255,255,.86)",
            maxWidth: 720,
            fontWeight: 500,
          }}
        >
          {meta.subtitle}
        </p>

        <div
          style={{
            marginTop: 8,
            padding: "10px 16px",
            borderRadius: "var(--radius-card)",
            background: "rgba(255,255,255,.92)",
            border: `1px solid ${accentColor}`,
            color: accentInk,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: ".02em",
            alignSelf: "flex-start",
          }}
        >
          {meta.heroFlowLabel}
        </div>
      </div>
    </section>
  );
}
