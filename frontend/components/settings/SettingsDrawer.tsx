/**
 * SettingsDrawer - 우측 슬라이드 드로어.
 * 4개 섹션 모두 Zustand 스토어 직결 (settings · process · 히스토리 정리 포함).
 *
 * localStorage 영속화는 각 스토어의 persist 미들웨어가 담당.
 * 이 파일은 렌더링만.
 */

"use client";

import type { ReactNode } from "react";
import Icon from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/primitives";
import { GENERATE_MODEL, EDIT_MODEL } from "@/lib/model-presets";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProcessStore, type ProcStatus } from "@/stores/useProcessStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";
import { setProcessStatus } from "@/lib/api-client";
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
            overflowY: "auto",
            padding: "6px 20px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <ProcessSection />
          <ModelSection />
          <TemplatesSection />
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
            letterSpacing: "-0.01em",
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
          borderRadius: 8,
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
   1. Process Control (Zustand)
   ───────────────────────────────── */

const PROCESSES: {
  key: "ollama" | "comfyui";
  name: string;
  desc: string;
  port: number;
}[] = [
  {
    key: "ollama",
    name: "Ollama",
    desc: "gemma4 · 프롬프트 업그레이드/비전",
    port: 11434,
  },
  {
    key: "comfyui",
    name: "ComfyUI",
    desc: "Qwen Image · 실제 이미지 생성",
    port: 8188,
  },
];

function ProcessSection() {
  const ollama = useProcessStore((s) => s.ollama);
  const comfyui = useProcessStore((s) => s.comfyui);
  const setOllama = useProcessStore((s) => s.setOllama);
  const setComfyui = useProcessStore((s) => s.setComfyui);

  const status: Record<"ollama" | "comfyui", ProcStatus> = {
    ollama,
    comfyui,
  };

  const toggle = async (key: "ollama" | "comfyui") => {
    const next: ProcStatus = status[key] === "running" ? "stopped" : "running";
    const action = next === "running" ? "start" : "stop";
    const res = await setProcessStatus(key, action);
    if (!res.ok) {
      toast.error(
        `${key === "ollama" ? "Ollama" : "ComfyUI"} ${action === "start" ? "시작" : "정지"} 실패`,
        res.message,
      );
      return;
    }
    if (key === "ollama") setOllama(next);
    else setComfyui(next);
    toast.success(
      `${key === "ollama" ? "Ollama" : "ComfyUI"} ${action === "start" ? "시작됨" : "정지됨"}`,
      next === "running" ? `:${PROCESSES.find((p) => p.key === key)?.port}` : undefined,
    );
  };

  return (
    <Section title="프로세스" desc="로컬 AI 런타임 상태와 실행 제어">
      {PROCESSES.map((p) => {
        const running = status[p.key] === "running";
        return (
          <div
            key={p.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 10,
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
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--ink-4)",
                    letterSpacing: ".04em",
                  }}
                >
                  :{p.port}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.desc}
              </div>
            </div>
            <button
              type="button"
              onClick={() => toggle(p.key)}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "5px 10px",
                fontSize: 11.5,
                fontWeight: 500,
                borderRadius: 6,
                border: `1px solid ${running ? "var(--line)" : "var(--accent)"}`,
                background: running ? "var(--bg)" : "var(--accent)",
                color: running ? "var(--ink-2)" : "#fff",
                transition: "all .15s",
              }}
            >
              {running ? "정지" : "시작"}
            </button>
          </div>
        );
      })}
      <div
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          paddingLeft: 4,
        }}
      >
        ⓘ 현재 Mock 상태. 실제 프로세스 제어는 Phase 2 백엔드 연결 후.
      </div>
    </Section>
  );
}

/* ─────────────────────────────────
   2. Model Selector
   ───────────────────────────────── */

const OLLAMA_OPTIONS = [
  "gemma4-un:latest",
  "gemma4-heretic:text-q4km",
  "super-sis:latest",
  "my-sister-26b:latest",
  "gemma4:26b",
];

function ModelSection() {
  const {
    generateModel,
    editModel,
    ollamaModel,
    visionModel,
    setGenerateModel,
    setEditModel,
    setOllamaModel,
    setVisionModel,
  } = useSettingsStore();

  return (
    <Section title="모델" desc="각 역할에서 사용할 로컬 모델 선택">
      <SelectRow
        label="생성"
        value={generateModel}
        options={[GENERATE_MODEL.displayName]}
        onChange={setGenerateModel}
      />
      <SelectRow
        label="수정"
        value={editModel}
        options={[EDIT_MODEL.displayName]}
        onChange={setEditModel}
      />
      <SelectRow
        label="텍스트 LLM (프롬프트 업그레이드)"
        value={ollamaModel}
        options={OLLAMA_OPTIONS}
        onChange={setOllamaModel}
      />
      <SelectRow
        label="비전 LLM (수정 모드 이미지 분석)"
        value={visionModel}
        options={["gemma4-heretic:vision-q4km"]}
        onChange={setVisionModel}
      />
    </Section>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 500 }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mono"
        style={{
          all: "unset",
          display: "block",
          width: "100%",
          cursor: "pointer",
          padding: "8px 10px",
          fontSize: 12,
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--surface)",
          color: "var(--ink)",
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ─────────────────────────────────
   3. Prompt Templates
   ───────────────────────────────── */
function TemplatesSection() {
  const templates = useSettingsStore((s) => s.templates);
  const removeTemplate = useSettingsStore((s) => s.removeTemplate);

  const remove = (id: string) => {
    removeTemplate(id);
    toast.info("템플릿 삭제됨");
  };

  return (
    <Section title="프롬프트 템플릿" desc="자주 쓰는 프롬프트 저장·불러오기">
      {templates.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-4)",
            padding: "10px 12px",
            border: "1px dashed var(--line-2)",
            borderRadius: 8,
          }}
        >
          저장된 템플릿이 없어요. 생성 화면 프롬프트에서 저장해보세요.
        </div>
      )}
      {templates.map((t) => (
        <div
          key={t.id}
          style={{
            padding: "10px 12px",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
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
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t.name}</span>
            <button
              type="button"
              onClick={() => remove(t.id)}
              style={{
                all: "unset",
                cursor: "pointer",
                fontSize: 10.5,
                color: "var(--ink-4)",
                padding: "2px 6px",
                borderRadius: 4,
              }}
              title="삭제"
            >
              <Icon name="x" size={11} />
            </button>
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
        </div>
      ))}
    </Section>
  );
}

/* ─────────────────────────────────
   4. Preferences
   ───────────────────────────────── */
function PreferencesSection() {
  const {
    showUpgradeStep,
    lightningByDefault,
    autoStartComfy,
    setShowUpgradeStep,
    setLightningByDefault,
    setAutoStartComfy,
  } = useSettingsStore();

  return (
    <Section title="프리퍼런스" desc="기본 동작 토글 · 모든 변경 즉시 저장">
      <Toggle
        checked={showUpgradeStep}
        onChange={setShowUpgradeStep}
        label="프롬프트 업그레이드 확인 단계 보이기"
        desc="gemma4 보강 결과를 모달로 먼저 확인"
      />
      <Toggle
        checked={lightningByDefault}
        onChange={(v) => {
          setLightningByDefault(v);
          toast.info(
            v ? "Lightning 기본 ON" : "Lightning 기본 OFF",
            "다음부터 생성 화면 진입 시 반영돼요.",
          );
        }}
        label="Lightning 모드 기본 ON"
        desc="생성 화면 진입 시 ⚡ 4-step 자동 선택"
      />
      <Toggle
        checked={autoStartComfy}
        onChange={setAutoStartComfy}
        label="앱 시작 시 ComfyUI 자동 실행"
        desc="VRAM 계속 점유 — 주의"
      />
    </Section>
  );
}

/* ─────────────────────────────────
   5. History 관리 (추가 섹션)
   ───────────────────────────────── */
function HistorySection() {
  const count = useHistoryStore((s) => s.items.length);
  const clear = useHistoryStore((s) => s.clear);

  const handleClear = () => {
    if (count === 0) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `히스토리 ${count}개를 모두 삭제할까요? (되돌릴 수 없음)`,
      );
      if (!ok) return;
    }
    clear();
    toast.success("히스토리 비워짐");
  };

  return (
    <Section title="히스토리" desc="생성/수정 기록 관리">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>저장된 기록</span>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
            }}
          >
            {count} items
          </span>
        </div>
        <button
          type="button"
          onClick={handleClear}
          disabled={count === 0}
          style={{
            all: "unset",
            cursor: count === 0 ? "not-allowed" : "pointer",
            padding: "5px 10px",
            fontSize: 11.5,
            fontWeight: 500,
            borderRadius: 6,
            border: "1px solid var(--line)",
            background: "var(--bg)",
            color: count === 0 ? "var(--ink-4)" : "#C0392B",
            opacity: count === 0 ? 0.5 : 1,
          }}
        >
          모두 삭제
        </button>
      </div>
    </Section>
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
      <div>AI Image Studio · v1.2.4 · LOCAL</div>
      <div>ComfyUI :8188 · Ollama :11434 · Backend :8000 (Phase 2)</div>
    </div>
  );
}
