/**
 * AppShell - 클라이언트 전역 래퍼.
 * Settings Drawer Provider 를 깔고, 드로어 본체를 상시 마운트.
 * layout.tsx(server component) 에서 <body> 안에 삽입.
 */

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { SettingsProvider } from "@/components/settings/SettingsContext";
import SettingsDrawer from "@/components/settings/SettingsDrawer";
import ToastHost from "@/components/ui/ToastHost";
import HistoryBootstrap from "./HistoryBootstrap";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { toast } from "@/stores/useToastStore";
import { fetchProcessStatus } from "@/lib/api-client";

/* 진입 시 autoStartComfy 프리퍼런스 반영 — 한 세션에서 1회만 */
function AutoStartBoot() {
  const autoStartComfy = useSettingsStore((s) => s.autoStartComfy);
  const comfyui = useProcessStore((s) => s.comfyui);
  const setComfyui = useProcessStore((s) => s.setComfyui);
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    if (!autoStartComfy) return;
    if (comfyui === "running") return;
    bootedRef.current = true;
    setComfyui("running");
    toast.info("ComfyUI 자동 시작", "설정의 '앱 시작 시 ComfyUI 자동 실행' ON");
  }, [autoStartComfy, comfyui, setComfyui]);

  return null;
}

/* ────────────────────────────────────────
   ProcessStatusPoller
   5초 주기로 /process/status 폴링 → running/VRAM 동기화
   Mock 모드에선 no-op (fetchProcessStatus 가 null 반환).
   ──────────────────────────────────────── */
function ProcessStatusPoller() {
  const applyStatus = useProcessStore((s) => s.applyStatus);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const snapshot = await fetchProcessStatus();
      if (cancelled || !snapshot) return;
      applyStatus({
        ollama: snapshot.ollamaRunning ? "running" : "stopped",
        comfyui: snapshot.comfyuiRunning ? "running" : "stopped",
        vram: snapshot.vram,
        ram: snapshot.ram,
        gpuPercent: snapshot.gpuPercent,
        cpuPercent: snapshot.cpuPercent,
        vramBreakdown: snapshot.vramBreakdown,
      });
    };

    // 진입 즉시 1회 + 5초 주기
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [applyStatus]);

  return null;
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <AutoStartBoot />
      <ProcessStatusPoller />
      <HistoryBootstrap />
      {children}
      <SettingsDrawer />
      <ToastHost />
    </SettingsProvider>
  );
}
