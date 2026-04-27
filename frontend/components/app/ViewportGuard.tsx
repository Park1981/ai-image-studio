/**
 * ViewportGuard — viewport 가 1024px 미만이면 안내 overlay 표시.
 * 2026-04-27 (UI P0-1): 데스크톱 전용 정책 명시 — 모바일/태블릿 미지원.
 *
 * 동작:
 *   - SSR 첫 렌더에서는 안 보임 (mounted state false).
 *   - 마운트 후 window 너비 측정 + resize listener.
 *   - 1024 미만이면 fixed full-screen overlay 위에 안내 메시지.
 *   - 1024 이상이면 overlay 자체 안 그림 (DOM 비용 0).
 *
 * 정책 근거:
 *   - 16GB VRAM 로컬 도구 — 모바일에서 ComfyUI 실행 자체 불가.
 *   - 좌패널 400 + 우패널 624 = 정확히 1024 fit. 그 이상에서 우패널 가변 확장.
 *   - StudioLayout.STUDIO_MIN_WIDTH 와 동일 값 (한 출처 = 한 진실).
 */

"use client";

import { useEffect, useState } from "react";

const MIN_WIDTH = 1024;

export default function ViewportGuard() {
  const [tooNarrow, setTooNarrow] = useState(false);
  const [mounted, setMounted] = useState(false);

  // resize listener 안 setState — 외부 이벤트 동기화 패턴 (React 19
  // set-state-in-effect rule 의 의도된 예외 케이스). useSyncExternalStore
  // 도 가능하지만 ViewportGuard 의 단일 boolean 추적엔 과한 추상화.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setMounted(true);
    const check = () => setTooNarrow(window.innerWidth < MIN_WIDTH);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // SSR / hydration 안전 — 마운트 전엔 아무것도 안 그림.
  if (!mounted || !tooNarrow) return null;

  return (
    <div
      role="alertdialog"
      aria-label="화면 크기 안내"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--overlay-dark, rgba(15, 17, 23, 0.92))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          background: "var(--surface, #fff)",
          borderRadius: "var(--radius-card, 16px)",
          padding: "28px 32px",
          boxShadow: "0 20px 60px rgba(0,0,0,.35)",
          textAlign: "center",
          color: "var(--ink, #1a1a1f)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            fontSize: 38,
            lineHeight: 1,
            marginBottom: 12,
          }}
        >
          🖥️
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: 0,
            color: "var(--ink, #1a1a1f)",
          }}
        >
          화면이 너무 좁습니다
        </h2>
        <p
          style={{
            margin: "10px 0 6px",
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--ink-3, #4a4d57)",
          }}
        >
          AI Image Studio 는 데스크톱 전용입니다.
          <br />
          창 너비를 <b>1024px 이상</b>으로 넓혀 주세요.
        </p>
        <p
          className="mono"
          style={{
            marginTop: 14,
            fontSize: 11,
            color: "var(--ink-4, #888)",
            letterSpacing: ".04em",
          }}
        >
          {/* 클라이언트만 렌더되니 window 안전 */}
          현재 너비 ·{" "}
          <span style={{ color: "var(--accent, #4a9eff)" }}>
            {typeof window !== "undefined" ? window.innerWidth : 0}px
          </span>
        </p>
      </div>
    </div>
  );
}
