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
import { fetchProcessStatus, setProcessStatus } from "@/lib/api/process";

/* 진입 시 autoStartComfy 프리퍼런스 반영 — 한 세션에서 1회만.
   이전: setComfyui("running") 만 호출 → UI 만 거짓 running 표시 (실제 backend 미시작).
   현재: 실제 /api/studio/process/comfyui/start 호출 → 성공 시 ProcessStatusPoller (5초 주기) 가
   실 상태를 반영. 실패 시 bootedRef 리셋해 다음 평가에서 재시도 가능. */
function AutoStartBoot() {
  const autoStartComfy = useSettingsStore((s) => s.autoStartComfy);
  const comfyui = useProcessStore((s) => s.comfyui);
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    if (!autoStartComfy) return;
    if (comfyui === "running") return;
    bootedRef.current = true;

    (async () => {
      const res = await setProcessStatus("comfyui", "start");
      if (res.ok) {
        toast.info(
          "ComfyUI 자동 시작",
          "백엔드에 시작 요청 전송 — 곧 상태 반영",
        );
        // 실제 running 전환은 ProcessStatusPoller (5초 주기) 가 자연 동기화
      } else {
        bootedRef.current = false;
        toast.error(
          "ComfyUI 자동 시작 실패",
          res.message ?? "백엔드 응답 오류",
        );
      }
    })();
  }, [autoStartComfy, comfyui]);

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
        ramBreakdown: snapshot.ramBreakdown,
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
