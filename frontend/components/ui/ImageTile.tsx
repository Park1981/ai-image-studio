/**
 * ImageTile - 결정론적(seed 기반) 이미지 플레이스홀더
 * Claude Design handoff 의 placeholders.jsx 포팅
 *
 * 실제 이미지 데이터가 없어도 "이미지처럼 보이는" 색 타일을 보여줌.
 * 나중에 실 이미지 URL 이 들어오면 이 컴포넌트를 조건 분기해서 <img/> 교체.
 */

"use client";

import type { CSSProperties, ReactNode } from "react";

// 12가지 따뜻한 팔레트 (sand, dusk, moss, clay, steel, honey, lilac, walnut, teal, terracotta, stone, ocean)
const PH_PALETTES: [string, string][] = [
  ["#E8DFD0", "#BFA980"],
  ["#D6E3EA", "#7E9BB0"],
  ["#DDE4D4", "#8AA27A"],
  ["#EAD9D2", "#B58679"],
  ["#D2D8E6", "#6C7AA3"],
  ["#EFE4D0", "#C49860"],
  ["#D9D2E1", "#8174A0"],
  ["#E2D7CC", "#9B7A5C"],
  ["#CEDFD9", "#5B8E82"],
  ["#EFE0D7", "#D08B6B"],
  ["#DCD4CA", "#70655C"],
  ["#CFD9E2", "#4F6B85"],
];

// 문자열 해시 (간단 djb2 스타일)
export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface ImageTileProps {
  seed?: string;
  label?: string;
  aspect?: string;
  style?: CSSProperties;
  overlay?: ReactNode;
  onClick?: () => void;
}

/** seed 가 실제 이미지 참조인지 (data URL · blob · http(s) · 로컬 path) 판별 */
function isImageRef(seed: string): boolean {
  return (
    seed.startsWith("data:") ||
    seed.startsWith("blob:") ||
    seed.startsWith("http://") ||
    seed.startsWith("https://") ||
    seed.startsWith("/images/") // backend 서빙 경로
  );
}

export default function ImageTile({
  seed = "a",
  label,
  aspect = "1 / 1",
  style,
  overlay,
  onClick,
}: ImageTileProps) {
  // 실 이미지면 <img> 렌더 + object-fit:contain 으로 잘림 없이 letterbox.
  if (isImageRef(seed)) {
    return (
      <div
        onClick={onClick}
        style={{
          position: "relative",
          aspectRatio: aspect,
          borderRadius: 10,
          overflow: "hidden",
          background: "var(--bg-2)", // letterbox 배경
          cursor: onClick ? "pointer" : "default",
          ...style,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={seed}
          alt={label || ""}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
        {label && (
          <div
            className="mono"
            style={{
              position: "absolute",
              left: 8,
              bottom: 8,
              fontSize: 10,
              letterSpacing: ".04em",
              color: "rgba(255,255,255,.92)",
              background: "rgba(0,0,0,.4)",
              padding: "2px 6px",
              borderRadius: 4,
              backdropFilter: "blur(4px)",
            }}
          >
            {label}
          </div>
        )}
        {overlay}
      </div>
    );
  }

  // 플레이스홀더 (결정론적 그라디언트)
  const h = hashStr(seed);
  const [c1, c2] = PH_PALETTES[h % PH_PALETTES.length];
  const angle = h % 180;
  const dotX = 20 + (h % 55);
  const dotY = 25 + ((h >> 3) % 55);
  const dotR = 18 + ((h >> 7) % 22);
  const pattern = (h >> 5) % 3;

  const bg =
    pattern === 0
      ? `linear-gradient(${angle}deg, ${c1} 0%, ${c2} 100%)`
      : pattern === 1
        ? `radial-gradient(circle at ${dotX}% ${dotY}%, ${c2} 0%, ${c1} 70%)`
        : `linear-gradient(${angle}deg, ${c1}, ${c2} 50%, ${c1})`;

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        aspectRatio: aspect,
        borderRadius: 10,
        overflow: "hidden",
        background: c1,
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {/* 배경 그라디언트 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: bg,
        }}
      />
      {/* 소프트 쉐입 (원/사각) */}
      <div
        style={{
          position: "absolute",
          left: `${dotX - dotR / 2}%`,
          top: `${dotY - dotR / 2}%`,
          width: `${dotR}%`,
          height: `${dotR}%`,
          borderRadius: pattern === 2 ? "4px" : "50%",
          background: c2,
          mixBlendMode: "multiply",
          opacity: 0.75,
          filter: "blur(0.5px)",
        }}
      />
      {/* 지평선 라인 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${55 + (h % 20)}%`,
          height: 1,
          background: "rgba(0,0,0,.06)",
        }}
      />
      {/* 필름 그레인 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0) 0 2px, rgba(0,0,0,.02) 2px 3px)",
          mixBlendMode: "overlay",
        }}
      />
      {label && (
        <div
          className="mono"
          style={{
            position: "absolute",
            left: 8,
            bottom: 8,
            fontSize: 10,
            letterSpacing: ".04em",
            color: "rgba(255,255,255,.92)",
            background: "rgba(0,0,0,.28)",
            padding: "2px 6px",
            borderRadius: 4,
            backdropFilter: "blur(4px)",
          }}
        >
          {label}
        </div>
      )}
      {overlay}
    </div>
  );
}

// 이미지 미배치 시 줄무늬 플레이스홀더
export function StripedPH({
  children,
  style,
}: {
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        background:
          "repeating-linear-gradient(135deg, #F4F1EB 0 10px, #EEEAE1 10px 20px)",
        border: "1px dashed #D4CEC0",
        borderRadius: 10,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
