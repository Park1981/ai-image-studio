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

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <AutoStartBoot />
      <HistoryBootstrap />
      {children}
      <SettingsDrawer />
      <ToastHost />
    </SettingsProvider>
  );
}
