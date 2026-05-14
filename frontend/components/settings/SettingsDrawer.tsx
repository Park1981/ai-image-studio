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
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSettings } from "./SettingsContext";

import Section from "./Section";
import ProcessSection from "./ProcessSection";
import SystemMetricsSection from "./SystemMetricsSection";
import HistorySection from "./HistorySection";
import ReferencePoolSection from "./ReferencePoolSection";
import { ToggleRow } from "./ToggleRow";

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
          width: 440,
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
            // 2026-05-14 Phase 3 fix: 헤더와 §01 사이 패딩 (6 → 22) 늘림.
            // gap 은 0 — 섹션 사이 간격은 `.ais-settings-section + .ais-settings-section`
            // 의 padding-top 22 (+ 점선 separator) 가 책임 (중복 방지).
            padding: "22px 20px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          <ProcessSection />
          <PreferencesSection />
          <SystemMetricsSection />
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
   Drawer header — Editorial Anatomy (2026-05-14 Phase 2)
   eyebrow + Fraunces italic bilingual + 상단 4px 다색 띠 + close 박스
   ───────────────────────────────── */
function DrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="ais-drawer-head">
      <div className="ais-drawer-head-meta">
        <div className="ais-drawer-eyebrow">IMAGE STUDIO · CONFIG · v1.3.0</div>
        <h2 className="ais-drawer-title">
          <strong>설정</strong>
          {" · "}
          Settings
        </h2>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="설정 닫기 (ESC)"
        title="설정 닫기 (ESC)"
        className="ais-drawer-close"
      >
        <Icon name="x" size={14} />
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
    <Section
      num="02"
      title="기본 설정"
      titleEn="Defaults"
      meta="AUTO-SAVE"
      desc="자주 바꾸는 기본값 · 모든 변경 즉시 저장"
    >
      {/* 통일 ToggleRow (2026-05-14):
       *  - 프롬프트 숨기기 (switch) 와 AI 보정 모드 (segmented) 가 같은 카드 wrapper 공유.
       *  - 옛 raw div 인라인 ad-hoc 카드의 토큰 어긋남 + segmented 라벨 줄바꿈 회귀 해소.
       *  - Phase 2 gemma4 보강 모드는 페이지 *마운트 시점* 의 기본값 (Codex 리뷰 Medium #2):
       *    사용자가 페이지에서 토글한 값은 session-only — 여기서 변경해도 즉시 안 덮음.
       *    다음 페이지 재진입 (또는 새로고침) 시점부터 반영. */}
      <ToggleRow
        marker={<Icon name="scan-eye" size={15} stroke={1.7} />}
        label="프롬프트 숨기기 (생성 · 수정 · 영상)"
        desc="진행/검수 모달에서 프롬프트 표시 여부"
        control={{
          variant: "switch",
          checked: hideAll,
          onChange: onToggleHideAll,
          ariaLabel: "프롬프트 숨기기",
        }}
      />
      <ToggleRow
        marker={<Icon name="stars" size={15} stroke={1.7} />}
        label="AI 보정 모드 기본값"
        tone="violet"
        control={{
          variant: "segmented",
          value: promptEnhanceMode,
          options: [
            { value: "fast", label: "instant" },
            { value: "precise", label: "thinking" },
          ],
          onChange: setPromptEnhanceMode,
          ariaLabel: "AI 보정 모드 기본값",
        }}
      />
    </Section>
  );
}

/* ─────────────────────────────────
   Footer info — Editorial Anatomy (2026-05-14 Phase 2)
   좌측 mark (Fraunces italic + version) · 우측 ports tag 행
   ───────────────────────────────── */
function FooterInfo() {
  return (
    <footer className="ais-drawer-foot">
      <div className="ais-drawer-foot-mark">
        <span className="ais-app"><em>AI Image Studio</em></span>
        <span className="ais-ver">LOCAL · v1.3.0</span>
      </div>
      <div className="ais-drawer-foot-ports">
        <span className="ais-port-tag">ComfyUI <b>8000</b></span>
        <span className="ais-port-tag">Ollama <b>11434</b></span>
        <span className="ais-port-tag">Backend <b>8001</b></span>
      </div>
    </footer>
  );
}
