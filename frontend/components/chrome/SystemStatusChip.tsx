/**
 * SystemStatusChip — TopBar 우측 ComfyUI 가동 상태 chip.
 *
 * 동작:
 *   - stopped (= 로딩 중) → 🔵 점멸 + "ComfyUI 준비 중…" 상시 표시
 *   - stopped → running 전환 직후 → 🟢 + "준비 완료" 2초간 노출 후 자동 fade out
 *   - running 안정 상태 → hidden (공간 차지 X)
 *   - running → stopped 다시 떨어지면 (백엔드 끊김 등) 즉시 다시 보임
 *
 * 위치 의미:
 *   글로벌 시스템 상태 전용. 메뉴 페이지의 모델 컨텍스트 (이전 ModelBadge)
 *   와는 의미 단위가 분리되어 있어 항상 우측 상단에 둔다.
 *
 * 2026-04-26 신설 — start.bat headless 가동 시 ComfyUI 늦게 켜지는 동안
 *   사용자가 생성/수정 트리거 못 하도록 직관적 표시 추가.
 */

"use client";

import { useEffect, useState } from "react";
import { useProcessStore } from "@/stores/useProcessStore";

/** 준비 완료 chip 자동 사라지는 딜레이 (ms) */
const READY_FADE_MS = 2000;

export default function SystemStatusChip() {
  const comfyui = useProcessStore((s) => s.comfyui);

  // 표시 phase: 로딩 중 | 막 준비됨 (2초 grace) | 안정 상태 (hidden)
  const [phase, setPhase] = useState<"loading" | "just-ready" | "idle">(
    comfyui === "running" ? "idle" : "loading",
  );

  // status 변화 감지 — React 19 권장 패턴 (effect 안 setState 회피).
  //   https://react.dev/reference/react/useState#storing-information-from-previous-renders
  // SizeCard (generate/page.tsx) 의 prev-state 비교 패턴과 동일.
  const [prevComfyui, setPrevComfyui] = useState(comfyui);
  if (prevComfyui !== comfyui) {
    setPrevComfyui(comfyui);
    setPhase(comfyui === "stopped" ? "loading" : "just-ready");
  }

  // just-ready → idle 자동 전이 (2초 후 자연스러운 fade out)
  // setTimeout 콜백 안 setState 는 외부 timer 콜백이라 OK.
  useEffect(() => {
    if (phase !== "just-ready") return;
    const t = setTimeout(() => setPhase("idle"), READY_FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;

  const isLoading = phase === "loading";
  const dotColor = isLoading ? "var(--accent)" : "var(--green)";
  const dotHaloColor = isLoading
    ? "rgba(74,158,255,.20)"
    : "rgba(82,196,26,.18)";
  const label = isLoading ? "ComfyUI 준비 중…" : "준비 완료";
  const tooltip = isLoading
    ? "ComfyUI 가 아직 로딩 중입니다. 완료되면 자동으로 사라집니다."
    : "모든 시스템 준비 완료";

  return (
    <div
      role="status"
      aria-live="polite"
      title={tooltip}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px 5px 10px",
        borderRadius: "var(--radius-full)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        fontSize: 12,
        color: "var(--ink-2)",
        // 진입/사라짐 자연스럽게 — 단, 안 보일 땐 return null 이라 transition 은
        // running grace 끝날 때만 의미 있음.
        animation: "fade-in .25s ease-out",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: `0 0 0 3px ${dotHaloColor}`,
          animation: isLoading
            ? "ais-status-pulse 1.4s ease-in-out infinite"
            : "none",
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>{label}</span>
    </div>
  );
}
