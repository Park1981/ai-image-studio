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
import { useGenerateStore } from "@/stores/useGenerateStore";
import { toast } from "@/stores/useToastStore";
import { setProcessStatus } from "@/lib/api/process";
import { USE_MOCK } from "@/lib/api/client";
import { clearHistory as apiClearHistory } from "@/lib/api/history";
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
          <ModelSection />
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

/** 프로세스 상태 + 수동 시작/정지 (2026-04-27 복원).
 *  ProcessStatusPoller (5초) 가 실 상태 동기화. start.ps1 이 라이프사이클 관리하지만
 *  디버깅 / VRAM 정리 위해 수동 컨트롤 필요. */
function ProcessSection() {
  const ollama = useProcessStore((s) => s.ollama);
  const comfyui = useProcessStore((s) => s.comfyui);
  const setOllama = useProcessStore((s) => s.setOllama);
  const setComfyui = useProcessStore((s) => s.setComfyui);

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
    <Section title="프로세스" desc="로컬 AI 런타임 상태">
      <StatusLine
        name="Ollama"
        port={11434}
        status={ollama}
        onToggle={() => toggle("ollama", ollama)}
      />
      <StatusLine
        name="ComfyUI"
        port={8188}
        status={comfyui}
        onToggle={() => toggle("comfyui", comfyui)}
      />
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

/** 프로세스 한 줄 — 카드 + dot + name + 포트 + 상태 칩 + 토글 버튼.
 *  하단 desc 는 제거 (gemma4 / Qwen Image 등 — 사용자 의미 ↓).
 *  토글 버튼은 chip 옆 작은 아이콘 — 디버깅/VRAM 정리 시점 사용. */
function StatusLine({
  name,
  port,
  status,
  onToggle,
}: {
  name: string;
  port: number;
  status: ProcStatus;
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
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
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
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 9px",
          borderRadius: "var(--radius-full)",
          background: running ? "rgba(82,196,26,.12)" : "var(--bg-2)",
          color: running ? "#15803d" : "var(--ink-3)",
          border: `1px solid ${running ? "rgba(82,196,26,.32)" : "var(--line)"}`,
        }}
      >
        {running ? "실행 중" : "정지"}
      </span>
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
   2. Model Info (display · 2026-04-27)
   ───────────────────────────────── */

/** 모델 정보 — 4개 라우트 (생성/수정/영상/비전) 표시 전용.
 *  카드 한 개 안에 행 4개. 라벨 = 보통 톤 / 모델명 = 진하게 + mono.
 *  좌측에 라벨별 accent dot 으로 분류. */
const MODEL_ROWS: { label: string; accent: string; model: string }[] = [
  { label: "이미지 생성", accent: "#3b82f6", model: GENERATE_MODEL.displayName }, // blue
  { label: "이미지 수정", accent: "#8b5cf6", model: EDIT_MODEL.displayName },     // violet
  { label: "영상 생성",   accent: "#f43f5e", model: "LTX Video 2.3" },           // rose
  { label: "이미지 분석", accent: "#22c55e", model: "qwen2.5vl:7b" },            // green
];

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
  accent,
  model,
  divider,
}: {
  label: string;
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
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: accent,
          flexShrink: 0,
        }}
      />
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
    lightningByDefault,
    autoStartComfy,
    autoCompareAnalysis,
    setHideGeneratePrompts,
    setHideEditPrompts,
    setHideVideoPrompts,
    setLightningByDefault,
    setAutoStartComfy,
    setAutoCompareAnalysis,
  } = useSettingsStore();

  return (
    <Section title="프리퍼런스" desc="기본 동작 토글 · 모든 변경 즉시 저장">
      <Toggle
        checked={hideGeneratePrompts}
        onChange={setHideGeneratePrompts}
        align="right"
        label="생성 프롬프트 숨기기"
        desc="ON: 바로 생성 + 진행 모달 프롬프트 접힘 / OFF: 생성 전 AI 프롬프트 검수 모달 + 진행 중 펼침"
      />
      <Toggle
        checked={hideEditPrompts}
        onChange={setHideEditPrompts}
        align="right"
        label="수정 프롬프트 숨기기"
        desc="ON: 진행 모달 프롬프트 접힘 (깔끔) / OFF: 진행 중 비전 분석·영어 프롬프트 펼침"
      />
      <Toggle
        checked={hideVideoPrompts}
        onChange={setHideVideoPrompts}
        align="right"
        label="영상 프롬프트 숨기기"
        desc="ON: 진행 모달 프롬프트 접힘 (깔끔) / OFF: 진행 중 비전 분석·LTX 영어 프롬프트 펼침"
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
        align="right"
        label="Lightning 모드 기본 ON"
        desc="생성 화면 진입 시 ⚡ 4-step 자동 선택"
      />
      <Toggle
        checked={autoCompareAnalysis}
        onChange={setAutoCompareAnalysis}
        align="right"
        label="수정 후 자동 비교 분석"
        desc="Edit 결과 완료 시 백그라운드로 5축 평가 (VRAM>13GB 시 skip)"
      />
      <Toggle
        checked={autoStartComfy}
        onChange={setAutoStartComfy}
        align="right"
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

  const handleClear = async () => {
    if (count === 0) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `히스토리 ${count}개를 모두 삭제할까요? (되돌릴 수 없음)`,
      );
      if (!ok) return;
    }
    // 서버에도 전파 (USE_MOCK=true 면 no-op)
    try {
      await apiClearHistory();
    } catch (e) {
      toast.warn(
        "서버 히스토리 삭제 실패",
        e instanceof Error ? e.message : "로컬만 비움",
      );
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
          borderRadius: "var(--radius)",
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
            borderRadius: "var(--radius-sm)",
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
      <div>AI Image Studio · v1.3.0 · LOCAL</div>
      <div>ComfyUI :8000 · Ollama :11434 · Backend :8001</div>
    </div>
  );
}
