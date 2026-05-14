/**
 * ProcessSection — 로컬 서비스 (Ollama + ComfyUI) 상태 + 시작/정지 + 모델 펼침.
 *
 * Phase 3.2 추출 (refactor doc 2026-04-30 §I2) — 옛 SettingsDrawer.tsx 의
 * ProcessSection / ServiceCard / OllamaModelList / ComfyuiModelList / StatusLine 5 함수.
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import { GENERATE_MODEL, EDIT_MODEL } from "@/lib/model-presets";
import { useProcessStore, type ProcStatus } from "@/stores/useProcessStore";
import { toast } from "@/stores/useToastStore";
import { setProcessStatus, listOllamaModels } from "@/lib/api/process";
import { USE_MOCK } from "@/lib/api/client";
import type { OllamaModel } from "@/lib/api/types";
import Section from "./Section";

/** 프로세스 상태 + 시작/정지 + 펼침 (모델 정보).
 *  Ollama 펼침: listOllamaModels — 실제 등록된 모델 동적 fetch.
 *  ComfyUI 펼침: 우리 앱이 사용하는 4개 모델 (생성/수정/영상/분석 — 정의값).
 *  ProcessStatusPoller (5초) 가 실 상태 동기화. */
export default function ProcessSection() {
  const ollama = useProcessStore((s) => s.ollama);
  const comfyui = useProcessStore((s) => s.comfyui);
  const setOllama = useProcessStore((s) => s.setOllama);
  const setComfyui = useProcessStore((s) => s.setComfyui);

  const [ollamaOpen, setOllamaOpen] = useState(false);
  const [comfyuiOpen, setComfyuiOpen] = useState(false);

  const [ollamaModels, setOllamaModels] = useState<OllamaModel[] | null>(null);
  useEffect(() => {
    if (!ollamaOpen || ollamaModels !== null) return;
    let cancelled = false;
    (async () => {
      const list = await listOllamaModels();
      if (!cancelled) setOllamaModels(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [ollamaOpen, ollamaModels]);

  const toggle = async (key: "ollama" | "comfyui", current: ProcStatus) => {
    const next: ProcStatus = current === "running" ? "stopped" : "running";
    const action = next === "running" ? "start" : "stop";
    const displayName = key === "ollama" ? "Ollama" : "ComfyUI";
    const res = await setProcessStatus(key, action);
    if (!res.ok) {
      toast.error(
        `${displayName} ${action === "start" ? "시작" : "정지"} 실패`,
        res.message,
      );
      return;
    }
    if (key === "ollama") setOllama(next);
    else setComfyui(next);
    toast.success(
      `${displayName} ${action === "start" ? "시작됨" : "정지됨"}`,
    );
  };

  const runningCount = (ollama === "running" ? 1 : 0) + (comfyui === "running" ? 1 : 0);
  return (
    <Section
      first
      num="01"
      title="로컬 서비스"
      titleEn="Local Services"
      meta={`${runningCount}/2 ${runningCount > 0 ? "ONLINE" : "OFFLINE"}`}
      desc="AI 런타임 상태 + 등록 모델"
    >
      <ServiceCard
        name="Ollama"
        port={11434}
        status={ollama}
        open={ollamaOpen}
        onExpand={() => setOllamaOpen((v) => !v)}
        onToggle={() => toggle("ollama", ollama)}
      >
        <OllamaModelList models={ollamaModels} />
      </ServiceCard>
      <ServiceCard
        name="ComfyUI"
        port={8000}
        status={comfyui}
        open={comfyuiOpen}
        onExpand={() => setComfyuiOpen((v) => !v)}
        onToggle={() => toggle("comfyui", comfyui)}
      >
        <ComfyuiModelList />
      </ServiceCard>
      {/* Mock 모드 안내 — start.ps1 정상 실행 시 USE_MOCK=false 라 숨김. */}
      {USE_MOCK && (
        <div
          style={{
            fontSize: 10.5,
            color: "var(--ink-4)",
            paddingLeft: 4,
          }}
        >
          ⓘ 현재 Mock 모드 (NEXT_PUBLIC_USE_MOCK=true). 백엔드 미연결 — 결과는 가짜.
        </div>
      )}
    </Section>
  );
}

/** 서비스 카드 — Editorial svc tile (2026-05-14 Phase 3):
 *  LED + Fraunces "Ollama/ComfyUI" + mono port + 모델/정지 액션 + 펼침. */
function ServiceCard({
  name,
  port,
  status,
  open,
  onExpand,
  onToggle,
  children,
}: {
  name: string;
  port: number;
  status: ProcStatus;
  open: boolean;
  onExpand: () => void;
  onToggle: () => void;
  children: ReactNode;
}) {
  const running = status === "running";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="ais-svc">
        <span
          className={`ais-svc-led${running ? "" : " is-down"}`}
          aria-hidden="true"
        />
        <div className="ais-svc-id">
          <span className="ais-svc-name">{name}</span>
          <span className="ais-svc-port">{port}</span>
        </div>
        <div className="ais-svc-actions">
          <button
            type="button"
            onClick={onExpand}
            title={open ? "접기" : "모델 보기"}
            aria-label={open ? "접기" : "모델 보기"}
            aria-expanded={open}
            className="ais-svc-btn"
          >
            {open ? "▴ 접기" : "▾ 모델"}
          </button>
          <button
            type="button"
            onClick={onToggle}
            title={running ? `${name} 정지` : `${name} 시작`}
            aria-label={running ? `${name} 정지` : `${name} 시작`}
            className={`ais-svc-btn${running ? " danger" : " is-on"}`}
          >
            {running ? "정지" : "시작"}
          </button>
        </div>
      </div>
      {open && <div className="ais-svc-expand">{children}</div>}
    </div>
  );
}

/** Ollama 등록 모델 목록 — 실제 fetch 결과. */
function OllamaModelList({ models }: { models: OllamaModel[] | null }) {
  if (models === null) {
    return (
      <div style={{ fontSize: 11, color: "var(--ink-4)", padding: "4px 0" }}>
        모델 목록 불러오는 중…
      </div>
    );
  }
  if (models.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--ink-4)", padding: "4px 0" }}>
        등록된 Ollama 모델이 없습니다. <code>ollama pull qwen2.5vl:7b</code> 등으로 추가.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {models.map((m) => (
        <div
          key={m.name}
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 11.5,
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--ink)", fontWeight: 600 }}
          >
            {m.name}
          </span>
          <span
            className="mono"
            style={{ color: "var(--ink-4)", fontSize: 10.5 }}
          >
            {m.size_gb} GB
          </span>
        </div>
      ))}
    </div>
  );
}

/** ComfyUI 사용 모델 — 우리 앱 정의 (생성/수정/영상/분석). */
const COMFYUI_MODEL_ROWS: {
  label: string;
  icon: IconName;
  accent: string;
  model: string;
}[] = [
  { label: "이미지 생성", icon: "image",    accent: "#3b82f6", model: GENERATE_MODEL.displayName },
  { label: "이미지 수정", icon: "wand",     accent: "#8b5cf6", model: EDIT_MODEL.displayName },
  { label: "영상 생성",   icon: "play",     accent: "#f43f5e", model: "LTX Video 2.3" },
  { label: "이미지 분석", icon: "scan-eye", accent: "#22c55e", model: "qwen2.5vl:7b" },
];

function ComfyuiModelList() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {COMFYUI_MODEL_ROWS.map((r) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
          }}
        >
          <span
            aria-hidden
            style={{ color: r.accent, display: "inline-flex", flexShrink: 0 }}
          >
            <Icon name={r.icon} size={13} stroke={1.7} />
          </span>
          <span
            style={{
              color: "var(--ink-3)",
              fontWeight: 500,
              minWidth: 76,
            }}
          >
            {r.label}
          </span>
          <span
            className="mono"
            style={{
              color: "var(--ink)",
              fontWeight: 600,
              flex: 1,
              textAlign: "right",
            }}
          >
            {r.model}
          </span>
        </div>
      ))}
    </div>
  );
}

