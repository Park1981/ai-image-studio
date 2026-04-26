/**
 * lib/api/process.ts — Ollama/ComfyUI 프로세스 제어 + 상태 + VRAM 폴링.
 * 2026-04-23 Opus S3.
 */

import { STUDIO_BASE, USE_MOCK } from "./client";
import type { OllamaModel, ProcessStatusSnapshot } from "./types";

/**
 * 백엔드 /process/status 폴링 — 프로세스 상태 + CPU/RAM/GPU%/VRAM 원샷 조회.
 * AppShell 의 ProcessStatusPoller 가 5s 주기로 호출.
 *
 * 2026-04-26: 응답 구조 확장 (system_metrics.py + router process_status).
 * 각 메트릭 누락 시 null 매핑 → 프론트 UI 에서 자동 미표시.
 */
export async function fetchProcessStatus(): Promise<ProcessStatusSnapshot | null> {
  if (USE_MOCK) {
    return null; // Mock 에선 store 기본값 유지
  }
  try {
    const res = await fetch(`${STUDIO_BASE}/api/studio/process/status`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ollama?: { running?: boolean };
      comfyui?: {
        running?: boolean;
        vram_used_gb?: number;
        vram_total_gb?: number;
        gpu_percent?: number;
      };
      system?: {
        cpu_percent?: number;
        ram_used_gb?: number;
        ram_total_gb?: number;
      };
    };

    // VRAM — total>0 일 때만 유효 (nvidia-smi 미설치 환경 처리)
    const vUsed = data.comfyui?.vram_used_gb;
    const vTotal = data.comfyui?.vram_total_gb;
    const vram =
      vUsed !== undefined && vTotal !== undefined && vTotal > 0
        ? { usedGb: vUsed, totalGb: vTotal }
        : null;

    // RAM — total>0 일 때만 유효 (psutil 실패 시 null)
    const rUsed = data.system?.ram_used_gb;
    const rTotal = data.system?.ram_total_gb;
    const ram =
      rUsed !== undefined && rTotal !== undefined && rTotal > 0
        ? { usedGb: rUsed, totalGb: rTotal }
        : null;

    return {
      ollamaRunning: !!data.ollama?.running,
      comfyuiRunning: !!data.comfyui?.running,
      vram,
      ram,
      gpuPercent: data.comfyui?.gpu_percent ?? null,
      cpuPercent: data.system?.cpu_percent ?? null,
    };
  } catch {
    return null;
  }
}

/** 현재 실행 중인 ComfyUI 작업 인터럽트 (전역). */
export async function interruptCurrent(): Promise<boolean> {
  if (USE_MOCK) return true;
  try {
    const res = await fetch(`${STUDIO_BASE}/api/studio/interrupt`, {
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function setProcessStatus(
  name: "ollama" | "comfyui",
  action: "start" | "stop",
): Promise<{ ok: boolean; message?: string }> {
  if (USE_MOCK) {
    // Mock: 즉시 성공
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true };
  }
  const res = await fetch(
    `${STUDIO_BASE}/api/studio/process/${name}/${action}`,
    { method: "POST" },
  );
  if (!res.ok) {
    return { ok: false, message: `${res.status}` };
  }
  return res.json();
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  if (USE_MOCK) {
    return [
      { name: "gemma4-un:latest", size_gb: 16, modified_at: "" },
      { name: "gemma4-heretic:text-q4km", size_gb: 16, modified_at: "" },
      { name: "qwen2.5vl:7b", size_gb: 5.5, modified_at: "" },
    ];
  }
  try {
    const res = await fetch(`${STUDIO_BASE}/api/studio/ollama/models`);
    if (!res.ok) return [];
    return (await res.json()) as OllamaModel[];
  } catch {
    return [];
  }
}
