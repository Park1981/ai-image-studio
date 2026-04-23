/**
 * VramBadge — TopBar 우상단의 VRAM 사용량 배지.
 * useProcessStore.vram 구독 (null 이면 렌더 스킵).
 * 2026-04-23 Opus F3: 양 페이지(TopBar) 의 하드코딩 "VRAM 11.4 / 24 GB" 대체.
 */

"use client";

import { useProcessStore } from "@/stores/useProcessStore";

export default function VramBadge() {
  const vram = useProcessStore((s) => s.vram);
  // nvidia-smi 실패 or Mock 모드 — 배지 자체 숨김
  if (!vram) return null;

  // 표시: 소수 1자리 (예: "11.4 / 24 GB")
  const used = vram.usedGb.toFixed(1);
  const total = Math.round(vram.totalGb);

  return (
    <div
      className="mono"
      style={{
        fontSize: 10.5,
        color: "var(--ink-4)",
        letterSpacing: ".05em",
        marginRight: 4,
      }}
      title={`ComfyUI VRAM ${used} / ${total} GB (nvidia-smi 5s 폴링)`}
    >
      VRAM {used} / {total} GB
    </div>
  );
}
