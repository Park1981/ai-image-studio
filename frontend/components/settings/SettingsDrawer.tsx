/**
 * SettingsDrawer - 우측 슬라이드 드로어 shell.
 *
 * Phase 3.2 (2026-04-30 · refactor doc §I2): 1466줄 → ~250줄 분할.
 * 섹션별 파일로 분리된 컴포넌트 composition + drawer 외형 + DrawerHeader + PreferencesSection + FooterInfo.
 *
 * 분리 결과:
 *  - Section.tsx              (공용 wrapper)
 *  - ProcessSection.tsx       (Ollama/ComfyUI 카드 + 모델 펼침)
 *  - SystemMetricsSection.tsx (CPU/GPU/VRAM/RAM 4-bar + 들여쓰기 분해)
 *  - HistorySection.tsx       (히스토리 통계 + 모드별 분해 + 모두 삭제)
 *  - ReferencePoolSection.tsx (임시 풀 사용량 + 고아 일괄 삭제 — v9 Phase D.1)
 *
 * 삭제 (옛 dead code):
 *  - ModelSection / ModelRow  (소비처 주석 처리됨 · 보존 함수 — git history 남음)
 *  - TemplatesSection         (소비처 주석 처리됨 · 보존 함수 — git history 남음)
 *
 * 유지 (소형):
 *  - PreferencesSection / FooterInfo (각 ~30줄 — 분리 가치 낮음)
 *
 * localStorage 영속화는 각 store 의 persist 미들웨어가 담당. 이 파일은 렌더링만.
 */

"use client";

import Icon from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/primitives";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSettings } from "./SettingsContext";

import Section from "./Section";
import ProcessSection from "./ProcessSection";
import SystemMetricsSection from "./SystemMetricsSection";
import HistorySection from "./HistorySection";
import ReferencePoolSection from "./ReferencePoolSection";

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
          <PreferencesSection />
          <HistorySection />
          {/* v9 (2026-04-29 · Phase D.1): 참조 임시 캐시 (cascade cleanup 수동 GC). */}
          <ReferencePoolSection />
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
            fontSize: 14,
            fontWeight: 700,
            color: "var(--ink)",
            letterSpacing: "-.005em",
            margin: 0,
          }}
        >
          설정
        </h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="설정 닫기"
        style={{
          all: "unset",
          cursor: "pointer",
          padding: 6,
          borderRadius: "var(--radius-sm)",
          color: "var(--ink-3)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .15s",
        }}
      >
        <Icon name="x" size={16} />
      </button>
    </header>
  );
}

/* ─────────────────────────────────
   Preferences (인라인 — 작아서 분리 안 함)
   ───────────────────────────────── */
function PreferencesSection() {
  const {
    hideGeneratePrompts,
    hideEditPrompts,
    hideVideoPrompts,
    setHideGeneratePrompts,
    setHideEditPrompts,
    setHideVideoPrompts,
    promptEnhanceMode,
    setPromptEnhanceMode,
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
      {/* Phase 2 (2026-05-01) — gemma4 보강 모드 default.
       *  페이지 *마운트 시점* 의 기본값 (Codex 리뷰 Medium #2 fix).
       *  사용자가 페이지에서 토글한 값은 session-only — 여기서 변경해도 즉시 안 덮음.
       *  설정 변경은 다음 페이지 재진입 (또는 새로고침) 시점부터 반영. */}
      <div
        role="radiogroup"
        aria-label="AI 보정 모드 기본값"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "8px 12px",
          marginTop: 8,
          borderRadius: 8,
          background: "var(--surface)",
          border: "1px solid var(--line)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
            🧠 AI 보정 모드 기본값
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              marginTop: 2,
            }}
          >
            페이지 마운트 시점의 기본 모드 (페이지 토글은 session-only · 다음 진입부터 반영)
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            gap: 2,
            padding: 2,
            borderRadius: 6,
            background: "var(--line)",
          }}
        >
          {(["fast", "precise"] as const).map((mode) => {
            const active = promptEnhanceMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPromptEnhanceMode(mode)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: "none",
                  cursor: "pointer",
                  color: active ? "var(--accent-ink)" : "var(--ink-3)",
                  background: active ? "var(--surface)" : "transparent",
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,.08)" : "none",
                  transition: "background 120ms, color 120ms",
                }}
              >
                {mode === "fast" ? "빠른" : "정밀"}
              </button>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────────────
   Footer info (인라인 — 작아서 분리 안 함)
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
