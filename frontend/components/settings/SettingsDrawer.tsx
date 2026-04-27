/**
 * SettingsDrawer - 우측 슬라이드 드로어.
 * 4개 섹션 모두 Zustand 스토어 직결 (settings · process · 히스토리 정리 포함).
 *
 * localStorage 영속화는 각 스토어의 persist 미들웨어가 담당.
 * 이 파일은 렌더링만.
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/primitives";
import { GENERATE_MODEL, EDIT_MODEL } from "@/lib/model-presets";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProcessStore, type ProcStatus } from "@/stores/useProcessStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useGenerateStore } from "@/stores/useGenerateStore";
import { toast } from "@/stores/useToastStore";
import { setProcessStatus, listOllamaModels } from "@/lib/api/process";
import { USE_MOCK } from "@/lib/api/client";
import { clearHistory as apiClearHistory, getHistoryStats } from "@/lib/api/history";
import type { HistoryStats, OllamaModel } from "@/lib/api/types";
import { useSettings } from "./SettingsContext";

/* ─────────────────────────────────
   Drawer shell
   ───────────────────────────────── */
export default function SettingsDrawer() {
  const { open, closeSettings } = useSettings();

  return (
    <>
      {/* Overlay */}
      <div
        onClick={closeSettings}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(23, 20, 14, 0.32)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity .22s ease",
          zIndex: 40,
        }}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="설정"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: "100vw",
          background: "var(--bg)",
          borderLeft: "1px solid var(--line)",
          boxShadow: "var(--shadow-lg)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform .28s cubic-bezier(.22,1,.36,1)",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <DrawerHeader onClose={closeSettings} />
        <div
          style={{
            flex: 1,
            // flex 자식의 min-height 기본값이 auto — 콘텐츠가 길면 축소되는 이슈 방지
            minHeight: 0,
            overflowY: "auto",
            padding: "6px 20px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <ProcessSection />
          <SystemMetricsSection />
          {/* 모델 섹션 비노출 (오빠 피드백 2026-04-27 후속): ProcessSection 의
           *  Ollama/ComfyUI 펼침으로 흡수됨. ModelSection 함수는 보존 — 필요 시 복원. */}
          {/* <ModelSection /> */}
          {/* 프롬프트 템플릿 — 사용 빈도 낮음으로 비노출 (오빠 피드백 2026-04-27).
           *  TemplatesSection 함수와 store 의 templates/addTemplate/removeTemplate 은 보존 —
           *  필요 시 이 한 줄만 다시 활성화. */}
          {/* <TemplatesSection /> */}
          <PreferencesSection />
          <HistorySection />
          <FooterInfo />
        </div>
      </aside>
    </>
  );
}

/* ─────────────────────────────────
   Drawer header
   ───────────────────────────────── */
function DrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 20px 12px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="gear" size={16} />
        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: 0,
          }}
        >
          설정
        </h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          all: "unset",
          cursor: "pointer",
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          transition: "all .15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-2)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
        aria-label="닫기"
        title="닫기 (ESC)"
      >
        <Icon name="x" size={16} />
      </button>
    </header>
  );
}

/* ─────────────────────────────────
   Section 공용 wrapper
   ───────────────────────────────── */
function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            color: "var(--ink-3)",
          }}
        >
          {title}
        </div>
        {desc && (
          <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>
            {desc}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </section>
  );
}

/* ─────────────────────────────────
   1. Process Status (read-only · 2026-04-27)
   ───────────────────────────────── */

/** 프로세스 상태 + 시작/정지 + 펼침 (모델 정보).
 *  Ollama 펼침: listOllamaModels — 실제 등록된 모델 동적 fetch.
 *  ComfyUI 펼침: 우리 앱이 사용하는 4개 모델 (생성/수정/영상/분석 — 정의값).
 *  ProcessStatusPoller (5초) 가 실 상태 동기화. */
function ProcessSection() {
  const ollama = useProcessStore((s) => s.ollama);
  const comfyui = useProcessStore((s) => s.comfyui);
  const setOllama = useProcessStore((s) => s.setOllama);
  const setComfyui = useProcessStore((s) => s.setComfyui);

  // 펼침 상태 — 각 서비스 독립.
  const [ollamaOpen, setOllamaOpen] = useState(false);
  const [comfyuiOpen, setComfyuiOpen] = useState(false);

  // Ollama 등록 모델 — 펼침 처음 열릴 때 fetch (lazy).
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

  return (
    <Section title="로컬 서비스" desc="AI 런타임 상태 + 등록 모델">
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
        port={8188}
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

/** 서비스 카드 — StatusLine + 펼침 토글 + 펼침 컨텐츠. */
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
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}
    >
      <StatusLine
        name={name}
        port={port}
        status={status}
        open={open}
        onExpand={onExpand}
        onToggle={onToggle}
      />
      {open && (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            background: "var(--bg-2)",
            padding: "8px 12px",
          }}
        >
          {children}
        </div>
      )}
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

/** 프로세스 한 줄 — dot + name + 포트 + 펼침 버튼 + 시작/정지.
 *  카드 박스는 부모 ServiceCard 가 담당 (펼침 영역 통합).
 *  좌측 dot 이 상태 표시 — chip 제거됨 (오빠 피드백). */
function StatusLine({
  name,
  port,
  status,
  open,
  onExpand,
  onToggle,
}: {
  name: string;
  port: number;
  status: ProcStatus;
  open: boolean;
  onExpand: () => void;
  onToggle: () => void;
}) {
  const running = status === "running";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: running ? "var(--green)" : "var(--ink-4)",
          boxShadow: running ? "0 0 0 3px rgba(82,196,26,.18)" : "none",
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          {name}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: ".04em",
          }}
        >
          :{port}
        </span>
      </div>
      {/* 펼침 토글 — 클릭 시 모델 목록 표시/접힘 */}
      <button
        type="button"
        onClick={onExpand}
        title={open ? "접기" : "모델 보기"}
        aria-label={open ? "접기" : "모델 보기"}
        aria-expanded={open}
        style={{
          all: "unset",
          cursor: "pointer",
          fontSize: 10.5,
          fontWeight: 500,
          padding: "4px 8px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--line)",
          background: "var(--bg)",
          color: "var(--ink-3)",
          transition: "all .15s",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
        }}
      >
        {open ? "▴ 접기" : "▾ 모델"}
      </button>
      <button
        type="button"
        onClick={onToggle}
        title={running ? `${name} 정지` : `${name} 시작`}
        aria-label={running ? `${name} 정지` : `${name} 시작`}
        style={{
          all: "unset",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          padding: "4px 10px",
          borderRadius: "var(--radius-sm)",
          border: `1px solid ${running ? "var(--line)" : "var(--accent)"}`,
          background: running ? "var(--bg)" : "var(--accent)",
          color: running ? "var(--ink-2)" : "#fff",
          transition: "all .15s",
          flexShrink: 0,
        }}
      >
        {running ? "정지" : "시작"}
      </button>
    </div>
  );
}

/* ─────────────────────────────────
   1.5 System Metrics (2026-04-27 신설 · 헤더 4-bar 의 상세 버전)
   ───────────────────────────────── */

/** CPU/GPU/VRAM/RAM 한 줄/한 막대 + VRAM/RAM 들여쓰기 분해.
 *  데이터 = useProcessStore (5초 폴링 결과 재사용 — 추가 fetch 없음). */
function SystemMetricsSection() {
  const cpuPercent = useProcessStore((s) => s.cpuPercent);
  const gpuPercent = useProcessStore((s) => s.gpuPercent);
  const vram = useProcessStore((s) => s.vram);
  const ram = useProcessStore((s) => s.ram);
  const vramBreakdown = useProcessStore((s) => s.vramBreakdown);
  const ramBreakdown = useProcessStore((s) => s.ramBreakdown);

  return (
    <Section title="리소스 모니터">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "12px 14px",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
        }}
      >
        <MetricBar
          label="CPU"
          accent="#06b6d4"
          percent={cpuPercent}
          rightText={cpuPercent != null ? `${cpuPercent.toFixed(1)}%` : "—"}
        />
        <MetricBar
          label="GPU"
          accent="#22c55e"
          percent={gpuPercent}
          rightText={gpuPercent != null ? `${gpuPercent.toFixed(1)}%` : "—"}
        />
        <div>
          <MetricBar
            label="VRAM"
            accent="#8b5cf6"
            percent={
              vram && vram.totalGb > 0
                ? (vram.usedGb / vram.totalGb) * 100
                : null
            }
            rightText={
              vram ? `${vram.usedGb.toFixed(1)} / ${vram.totalGb.toFixed(0)} GB` : "—"
            }
          />
          {vramBreakdown && (
            <BreakdownLines
              lines={[
                {
                  label: "Ollama",
                  value: vramBreakdown.ollama.vramGb,
                  detail: vramBreakdown.ollama.models.length
                    ? vramBreakdown.ollama.models[0].name
                    : undefined,
                },
                {
                  label: "ComfyUI",
                  value: vramBreakdown.comfyui.vramGb,
                  detail: vramBreakdown.comfyui.models.length
                    ? vramBreakdown.comfyui.models[0]
                    : undefined,
                },
                { label: "기타", value: vramBreakdown.otherGb },
              ]}
              unit="GB"
            />
          )}
        </div>
        <div>
          <MetricBar
            label="RAM"
            accent="#f59e0b"
            percent={
              ram && ram.totalGb > 0
                ? (ram.usedGb / ram.totalGb) * 100
                : null
            }
            rightText={
              ram ? `${ram.usedGb.toFixed(1)} / ${ram.totalGb.toFixed(0)} GB` : "—"
            }
          />
          {ramBreakdown && (
            <BreakdownLines
              lines={[
                { label: "Backend", value: ramBreakdown.backendGb },
                { label: "ComfyUI", value: ramBreakdown.comfyuiGb },
                { label: "Ollama", value: ramBreakdown.ollamaGb },
                { label: "기타", value: ramBreakdown.otherGb },
              ]}
              unit="GB"
            />
          )}
        </div>
      </div>
    </Section>
  );
}

/** 막대 한 줄 — label + bar + 우측 수치. percent null = 측정 불가 (회색 빈 막대). */
function MetricBar({
  label,
  accent,
  percent,
  rightText,
}: {
  label: string;
  accent: string;
  percent: number | null;
  rightText: string;
}) {
  const clamped = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--ink-2)",
            letterSpacing: ".02em",
          }}
        >
          {label}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            fontWeight: 500,
          }}
        >
          {rightText}
        </span>
      </div>
      <div
        style={{
          height: 6,
          width: "100%",
          background: "var(--bg-2)",
          borderRadius: "var(--radius-full)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${clamped}%`,
            background: accent,
            transition: "width .3s ease, background .2s",
          }}
        />
      </div>
    </div>
  );
}

/** 들여쓰기 분해 라인 — VRAM/RAM 아래 ↳ 형태.
 *  값이 < 0.05 GB (≈ 50MB) 인 항목은 숨김 (오빠 피드백 2026-04-27 — 0GB 노이즈 제거).
 *  모든 값이 임계 미만이면 컴포넌트 자체 안 그림. */
function BreakdownLines({
  lines,
  unit,
  threshold = 0.05,
}: {
  lines: Array<{ label: string; value: number; detail?: string }>;
  unit: string;
  /** 이 값 미만은 숨김 (default 0.05 GB) */
  threshold?: number;
}) {
  const visible = lines.filter((l) => l.value >= threshold);
  if (visible.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 6,
        paddingLeft: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {visible.map((l) => (
        <div
          key={l.label}
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 10.5,
          }}
        >
          <span style={{ color: "var(--ink-4)" }}>
            <span style={{ marginRight: 4 }}>↳</span>
            {l.label}
            {l.detail && (
              <span
                className="mono"
                style={{
                  marginLeft: 6,
                  fontSize: 9.5,
                  color: "var(--ink-4)",
                  opacity: 0.7,
                }}
              >
                {l.detail}
              </span>
            )}
          </span>
          <span
            className="mono"
            style={{
              color: "var(--ink-3)",
              fontWeight: 500,
            }}
          >
            {l.value.toFixed(2)} {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────
   2. Model Info (display · 2026-04-27)
   ───────────────────────────────── */

/** 모델 정보 — 4개 라우트 (생성/수정/영상/비전) 표시 전용.
 *  카드 한 개 안에 행 4개. 라벨 = 보통 톤 / 모델명 = 진하게 + mono.
 *  좌측 아이콘 = 메인 메뉴 카드와 동일 (image/wand/play/scan-eye) + accent 컬러.
 *  2026-04-27 (오빠 피드백): dot 원형 → 아이콘 변경. */
const MODEL_ROWS: {
  label: string;
  icon: IconName;
  accent: string;
  model: string;
}[] = [
  { label: "이미지 생성", icon: "image",    accent: "#3b82f6", model: GENERATE_MODEL.displayName }, // blue
  { label: "이미지 수정", icon: "wand",     accent: "#8b5cf6", model: EDIT_MODEL.displayName },     // violet
  { label: "영상 생성",   icon: "play",     accent: "#f43f5e", model: "LTX Video 2.3" },           // rose
  { label: "이미지 분석", icon: "scan-eye", accent: "#22c55e", model: "qwen2.5vl:7b" },            // green
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ModelSection() {
  return (
    <Section title="모델" desc="각 작업에 사용 중인 로컬 모델">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        {MODEL_ROWS.map((r, idx) => (
          <ModelRow
            key={r.label}
            label={r.label}
            icon={r.icon}
            accent={r.accent}
            model={r.model}
            divider={idx < MODEL_ROWS.length - 1}
          />
        ))}
      </div>
    </Section>
  );
}

function ModelRow({
  label,
  icon,
  accent,
  model,
  divider,
}: {
  label: string;
  icon: IconName;
  accent: string;
  model: string;
  divider: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderBottom: divider ? "1px solid var(--line)" : "none",
      }}
    >
      <span
        aria-hidden
        style={{
          color: accent,
          display: "inline-flex",
          flexShrink: 0,
        }}
      >
        <Icon name={icon} size={16} stroke={1.7} />
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          fontWeight: 500,
          minWidth: 78,
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: "var(--ink)",
          letterSpacing: "-.005em",
          flex: 1,
          textAlign: "right",
        }}
      >
        {model}
      </span>
    </div>
  );
}

/* ─────────────────────────────────
   3. Prompt Templates (현재 비노출 — 2026-04-27 호출만 주석 처리)
   ───────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function TemplatesSection() {
  const templates = useSettingsStore((s) => s.templates);
  const removeTemplate = useSettingsStore((s) => s.removeTemplate);
  const { closeSettings } = useSettings();

  const remove = (id: string) => {
    removeTemplate(id);
    toast.info("템플릿 삭제됨");
  };

  const loadIntoGenerate = (t: PromptTemplateLike) => {
    useGenerateStore.getState().setPrompt(t.text);
    closeSettings();
    toast.success("템플릿 불러옴", `"${t.name}" 프롬프트로 세팅됨`);
  };

  return (
    <Section title="프롬프트 템플릿" desc="클릭해서 생성 화면에 불러오기">
      {templates.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-4)",
            padding: "10px 12px",
            border: "1px dashed var(--line-2)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          저장된 템플릿이 없습니다. 생성 화면의 프롬프트 입력창 옆
          <b>&ldquo;템플릿 저장&rdquo;</b> 버튼을 눌러서 추가해 주세요.
        </div>
      )}
      {templates.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => loadIntoGenerate(t)}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "10px 12px",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            transition: "all .15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor =
              "var(--accent)";
            (e.currentTarget as HTMLElement).style.background =
              "var(--accent-soft)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--line)";
            (e.currentTarget as HTMLElement).style.background =
              "var(--surface)";
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="arrow-right" size={11} />
              {t.name}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                remove(t.id);
              }}
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                padding: "2px 6px",
                borderRadius: 4,
                cursor: "pointer",
              }}
              title="삭제"
            >
              <Icon name="x" size={11} />
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              lineHeight: 1.5,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {t.text}
          </div>
        </button>
      ))}
    </Section>
  );
}

interface PromptTemplateLike {
  id: string;
  name: string;
  text: string;
}

/* ─────────────────────────────────
   4. Preferences
   ───────────────────────────────── */
function PreferencesSection() {
  const {
    hideGeneratePrompts,
    hideEditPrompts,
    hideVideoPrompts,
    setHideGeneratePrompts,
    setHideEditPrompts,
    setHideVideoPrompts,
  } = useSettingsStore();
  // 비노출 (오빠 피드백 2026-04-27 후속4):
  //  - lightningByDefault — 각 페이지 좌측 패널 lightning 토글로 충분 (중복 제거).
  //  - autoCompareAnalysis — Edit 좌측 패널로 이동 (작업 단위 contextual 결정).
  //  - autoStartComfy — 당장 불필요.
  //  store 의 필드 + setter 는 모두 보존 (다른 곳에서 사용 / 미래 복원 대비).

  // 통합 토글 — 3개 모두 동시 on/off (오빠 피드백 2026-04-27 후속4).
  // checked: 3개 모두 ON 일 때만 ON 표시 (옛 사용자가 따로 토글한 케이스 대비).
  const hideAll = hideGeneratePrompts && hideEditPrompts && hideVideoPrompts;
  const onToggleHideAll = (v: boolean) => {
    setHideGeneratePrompts(v);
    setHideEditPrompts(v);
    setHideVideoPrompts(v);
  };

  return (
    <Section title="기본 설정" desc="기본 동작 토글 · 모든 변경 즉시 저장">
      <Toggle
        checked={hideAll}
        onChange={onToggleHideAll}
        align="right"
        label="프롬프트 숨기기 (생성 · 수정 · 영상)"
        desc="ON: 진행 모달 프롬프트 접힘 + 생성 전 검수 모달 미노출 / OFF: 펼침 + 검수 모달 노출"
      />
    </Section>
  );
}

/* ─────────────────────────────────
   5. History (2026-04-27 통계 카드 확장)
   ───────────────────────────────── */

/** 바이트 → 사람 친화 문자열 (KB/MB/GB). */
function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function HistorySection() {
  const count = useHistoryStore((s) => s.items.length);
  const clear = useHistoryStore((s) => s.clear);

  // 서버 통계 — 설정 열릴 때마다 1회 + 30초 주기 갱신.
  const [stats, setStats] = useState<HistoryStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const s = await getHistoryStats();
      if (!cancelled) setStats(s);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleClear = async () => {
    if (count === 0) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `히스토리 ${count}개를 모두 삭제할까요? (되돌릴 수 없음)`,
      );
      if (!ok) return;
    }
    try {
      await apiClearHistory();
    } catch (e) {
      toast.warn(
        "서버 히스토리 삭제 실패",
        e instanceof Error ? e.message : "로컬만 비움",
      );
    }
    clear();
    setStats({
      count: 0,
      totalSizeBytes: 0,
      dbSizeBytes: stats?.dbSizeBytes ?? 0,
      byMode: {
        generate: { count: 0, sizeBytes: 0 },
        edit: { count: 0, sizeBytes: 0 },
        video: { count: 0, sizeBytes: 0 },
      },
    });
    toast.success("히스토리 비워짐");
  };

  // 갯수 = 서버 통계 우선, 없으면 store 폴백.
  const displayCount = stats?.count ?? count;
  const totalSize = stats?.totalSizeBytes ?? 0;
  const dbSize = stats?.dbSizeBytes ?? 0;

  return (
    <Section title="히스토리" desc="생성/수정/영상 기록 + 디스크 사용량">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        {/* 상단 — 총 갯수 + 총 용량 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
              저장된 기록
            </span>
            <span
              className="mono"
              style={{ fontSize: 10.5, color: "var(--ink-4)" }}
            >
              DB {fmtBytes(dbSize)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              className="mono"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--ink)",
              }}
            >
              {displayCount}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-3)",
                fontWeight: 500,
              }}
            >
              {fmtBytes(totalSize)}
            </span>
          </div>
        </div>

        {/* 모드별 분해 */}
        {stats && (
          <>
            <HistoryModeRow
              icon="image"
              accent="#3b82f6"
              label="이미지 생성"
              count={stats.byMode.generate.count}
              sizeBytes={stats.byMode.generate.sizeBytes}
            />
            <HistoryModeRow
              icon="wand"
              accent="#8b5cf6"
              label="이미지 수정"
              count={stats.byMode.edit.count}
              sizeBytes={stats.byMode.edit.sizeBytes}
            />
            <HistoryModeRow
              icon="play"
              accent="#f43f5e"
              label="영상 생성"
              count={stats.byMode.video.count}
              sizeBytes={stats.byMode.video.sizeBytes}
              divider={false}
            />
          </>
        )}

        {/* 하단 액션 */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "8px 12px",
            background: "var(--bg-2)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            onClick={handleClear}
            disabled={displayCount === 0}
            style={{
              all: "unset",
              cursor: displayCount === 0 ? "not-allowed" : "pointer",
              padding: "5px 10px",
              fontSize: 11.5,
              fontWeight: 500,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
              background: "var(--bg)",
              color: displayCount === 0 ? "var(--ink-4)" : "#C0392B",
              opacity: displayCount === 0 ? 0.5 : 1,
            }}
          >
            모두 삭제
          </button>
        </div>
      </div>
    </Section>
  );
}

function HistoryModeRow({
  icon,
  accent,
  label,
  count,
  sizeBytes,
  divider = true,
}: {
  icon: IconName;
  accent: string;
  label: string;
  count: number;
  sizeBytes: number;
  divider?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderBottom: divider ? "1px solid var(--line)" : "none",
        opacity: count === 0 ? 0.55 : 1,
      }}
    >
      <span
        aria-hidden
        style={{ color: accent, display: "inline-flex", flexShrink: 0 }}
      >
        <Icon name={icon} size={14} stroke={1.7} />
      </span>
      <span
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          fontWeight: 500,
          flex: 1,
        }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 11.5,
          color: "var(--ink)",
          fontWeight: 600,
          minWidth: 30,
          textAlign: "right",
        }}
      >
        {count}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          minWidth: 60,
          textAlign: "right",
        }}
      >
        {fmtBytes(sizeBytes)}
      </span>
    </div>
  );
}

/* ─────────────────────────────────
   Footer info
   ───────────────────────────────── */
function FooterInfo() {
  return (
    <div
      className="mono"
      style={{
        marginTop: 8,
        paddingTop: 14,
        borderTop: "1px solid var(--line)",
        fontSize: 10.5,
        color: "var(--ink-4)",
        letterSpacing: ".04em",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div>AI Image Studio · v1.3.0 · LOCAL</div>
      <div>ComfyUI :8000 · Ollama :11434 · Backend :8001</div>
    </div>
  );
}
