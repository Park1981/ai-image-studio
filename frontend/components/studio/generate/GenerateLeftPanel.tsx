/**
 * GenerateLeftPanel — Generate 페이지 좌측 입력 패널.
 *
 * 포함:
 *  - StudioModeHeader (mode 타이틀)
 *  - 프롬프트 카드 (textarea + 템플릿 저장 + 비우기)
 *  - PromptHistoryPeek (스프링 메뉴)
 *  - ResearchBanner (Claude 조사 인라인)
 *  - Lightning Toggle
 *  - SizeCard (W/H + 비율잠금)
 *  - Primary CTA (sticky · 진행 progress 바)
 *
 * 2026-04-26 (task #5): generate/page.tsx 1,800+ 줄 분해 step 2.
 *  Store 직접 구독 (useGenerateInputs/useGenerateRunning) → page.tsx 의 prop drilling 차단.
 *
 * 2026-04-27 (UX 폴리시): Primary CTA 가 패널 하단 → 상단으로 이동 (오빠 피드백).
 *  StudioModeHeader 직후 배치, sticky top:64px → 폼 길어져도 항상 시야 안.
 */

"use client";

import { useEffect, useState, type RefObject } from "react";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import PromptModeRadio from "@/components/studio/PromptModeRadio";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import PromptToolsResults from "@/components/studio/prompt-tools/PromptToolsResults";
import { usePromptModeInit } from "@/hooks/usePromptModeInit";
import { usePromptTools } from "@/hooks/usePromptTools";
import ResearchBanner from "@/components/studio/ResearchBanner";
import SnippetLibraryModal from "@/components/studio/SnippetLibraryModal";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import {
  StudioLeftPanel,
  StudioModeHeader,
} from "@/components/studio/StudioLayout";
import V5MotionCard from "@/components/studio/V5MotionCard";
import Icon from "@/components/ui/Icon";
import { Spinner, Toggle } from "@/components/ui/primitives";
import {
  hasMarker,
  stripAllLibBlocks,
  wrapMarker,
} from "@/lib/snippet-marker";
import {
  useGenerateInputs,
  useGenerateRunning,
} from "@/stores/useGenerateStore";
import {
  type PromptSnippet,
  usePromptSnippetsStore,
} from "@/stores/usePromptSnippetsStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import SizeCard from "./SizeCard";

// 2026-04-30 (localStorage quota 후속 fix): 옛 PNG 썸네일 → WebP 마이그레이션
// 모듈 레벨 flag 로 첫 mount 1회만 실행 (페이지 재진입 시 idempotent skip).
let snippetThumbsMigrated = false;

interface Props {
  /** prompt textarea ref — useAutoGrowTextarea 훅이 부모에서 관리 */
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 생성 트리거 (useGeneratePipeline.generate) */
  onGenerate: () => void;
}

export default function GenerateLeftPanel({
  promptTextareaRef,
  onGenerate,
}: Props) {
  const {
    prompt, setPrompt,
    aspect, setAspect,
    width, height, setWidth, setHeight,
    aspectLocked, setAspectLocked,
    research, setResearch,
    lightning, applyLightning,
    skipUpgrade, setSkipUpgrade,
    promptMode, setPromptMode,
  } = useGenerateInputs();
  const { generating, progress, stage } = useGenerateRunning();

  // Codex Phase 5 fix Medium — settings 의 ollamaModel override 를 도구로 전파.
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);

  // Phase 5 후속 (2026-05-01) — 프롬프트 도구 (번역/분리) state + 핸들러 통합 hook.
  // PromptToolsButtons (textarea 안) + PromptToolsResults (textarea 외부) 가 같은 hook 공유.
  const promptTools = usePromptTools({
    prompt,
    onPromptChange: setPrompt,
    ollamaModel: ollamaModelSel,
    disabled: generating,
  });

  // Phase 2 (2026-05-01 · 2026-05-06 hook 추출) — session-only 정책 sync.
  // 자세한 배경은 `hooks/usePromptModeInit.ts` 주석.
  usePromptModeInit(setPromptMode);

  // 2026-04-30 (Phase 2B Task 7 + 후속 UX): 라이브러리 모달 state 만 유지.
  // [+ 라이브러리에 등록] 별도 버튼 제거 — LibraryModal 안 [+ 새 등록] 으로 통합.
  const [libraryOpen, setLibraryOpen] = useState(false);

  // 2026-04-30 (localStorage quota 후속 fix): 마운트 1회 자동 마이그레이션.
  // 옛 PNG dataURL 썸네일을 WebP 256px 로 압축 (idempotent — 이미 webp 면 skip).
  useEffect(() => {
    if (snippetThumbsMigrated) return;
    snippetThumbsMigrated = true;
    void usePromptSnippetsStore.getState().migrateLargeThumbnails();
  }, []);

  // 카드 클릭 → textarea 의 lib 블록 *단일 활성* 토글 + 모달 자동 닫기.
  // 2026-04-30 (오빠 결정 — 단일 활성 정책):
  //   어떤 lib 카드든 한 번에 1개만 적용. 다른 카드 클릭 시 기존 마커 통째로 교체.
  //   - wasActive (= 같은 카드 다시 클릭): 마커 제거 → 0개 (토글 OFF)
  //   - 아니면: 모든 기존 lib 블록 제거 + 새 마커 1개만 끝에 삽입 (단일 활성)
  //
  //   커서 위치 삽입은 단일 활성 정책에서 의미 약함 (어디 넣든 1개) → 끝 추가가 자연스러움.
  const handleToggleSnippet = (snip: PromptSnippet) => {
    const closeAndFocus = (newCursor?: number) => {
      setLibraryOpen(false);
      requestAnimationFrame(() => {
        const ta = promptTextareaRef.current;
        if (!ta) return;
        ta.focus();
        if (typeof newCursor === "number") {
          ta.setSelectionRange(newCursor, newCursor);
        }
      });
    };

    const wasActive = hasMarker(prompt, snip.prompt);
    // 기존 lib 블록 모두 통째로 제거 (마커 + 안 내용 + 콤마 정리)
    const stripped = stripAllLibBlocks(prompt);

    // wasActive: 같은 카드 다시 클릭 → 0개 상태로 (토글 OFF)
    if (wasActive) {
      setPrompt(stripped);
      closeAndFocus(stripped.length);
      return;
    }

    // 다른 카드 클릭 (또는 첫 활성) → stripped 끝에 새 마커 1개만
    const wrapped = wrapMarker(snip.prompt);
    if (!stripped.trim()) {
      setPrompt(wrapped);
      closeAndFocus(wrapped.length);
      return;
    }
    const next = `${stripped.trimEnd()}, ${wrapped}`;
    setPrompt(next);
    closeAndFocus(next.length);
  };

  const sizeLabel = `${width}×${height}`;

  return (
    <StudioLeftPanel>
      <StudioModeHeader
        titleKo="생성"
        titleEn="Generate"
        eyebrow="MODE · GENERATE"
        description="프롬프트를 다듬고 로컬 ComfyUI로 이미지를 생성합니다."
        flowHref="/prompt-flow/generate"
        flowLabel="이 모드의 프롬프트 흐름 보기 (분기 트리)"
      />

      {/* Primary CTA — sticky 상단 (폼 길어지면 따라옴 · generate 전용 클래스).
       *  Phase 1.5.2 (결정 K) — shortcut (⇧↵) 표시 제거. 기능 미구현 유지.
       *  CSS .ais-cta-shortcut 자체는 보존 (향후 단축키 기능 살릴 때 재사용). */}
      <div className="ais-cta-sticky-top">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating || !prompt.trim()}
          className="ais-cta-primary"
        >
          {generating ? (
            <>
              <div
                className="ais-cta-progress"
                style={{ width: `${progress}%` }}
              />
              <span className="ais-cta-content">
                <Spinner />
                {stage} · {Math.round(progress)}%
              </span>
            </>
          ) : (
            <>
              <Icon name="sparkle" size={15} />
              Generate
            </>
          )}
        </button>
      </div>

      {/* ── 프롬프트 카드 ── */}
      {/* 2026-05-01 (UX 통일): Compare/Edit/Video 와 동일한 auto-grow textarea
       *  + 우하단 X 아이콘 박스 패턴. */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            프롬프트
          </label>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title="프롬프트 라이브러리 (등록도 모달 안에서)"
          >
            <Icon name="grid" size={11} /> 라이브러리에서 선택
          </button>
        </div>
        <div className="ais-prompt-shell">
          <PromptHistoryPeek mode="generate" onSelect={(p) => setPrompt(p)} />
          <textarea
            ref={promptTextareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="자연어로 자유롭게 입력. 예: 책 읽는 고양이, 창가, 늦은 오후..."
            rows={3}
            className="ais-prompt-textarea"
          />
          {/* Phase 5 후속 (2026-05-01) — 도구 버튼 (번역/분리) textarea 안 우측.
           *  히스토리 (top:10) 하단 + 비우기 (bottom:10) 위 영역에 세로 stack. */}
          <PromptToolsButtons tools={promptTools} />
          {prompt.length > 0 && (
            <button
              type="button"
              onClick={() => setPrompt("")}
              aria-label="프롬프트 비우기"
              title="프롬프트 비우기"
              className="ais-prompt-clear-icon"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        {/* 번역/분리 결과 카드 — 도구 버튼 클릭 후 textarea 외부 아래에 펼침. */}
        <PromptToolsResults tools={promptTools} />
      </div>

      {/* ── 라이브러리 모달 (Task 6/7 · 신규 등록은 모달 내부 [+ 새 등록] 으로) ── */}
      <SnippetLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        currentPrompt={prompt}
        onToggleSnippet={handleToggleSnippet}
      />

      {/* AI 보정 카드 — 토글 + (ON 일 때만) instant/thinking segmented 통합.
       *  Phase 1.5.2 (2026-05-02): V5 시그니처 카드 (.ais-toggle-card .ais-sig-ai · violet/blue) 적용.
       *    옛: .ais-magic-prompt-card (단순 회색/blue 카드).
       *    신: V5 인물 webp 배경 + active=padding 38 + violet glow.
       *  Toggle flat=true → 카드 wrapper 가 색 책임. Toggle 의 visually-transparent input 이
       *  카드 전체 click 처리. segmented 는 stopPropagation 으로 토글 영향 차단. */}
      <V5MotionCard
        className="ais-toggle-card ais-sig-ai"
        data-active={!skipUpgrade}
        onClick={() => setSkipUpgrade(!skipUpgrade)}
        tooltip={
          skipUpgrade
            ? "OFF · 프롬프트 그대로 사용 (~10초 절약)"
            : "ON · 한국어/자연어 → 영문 정제"
        }
      >
        {/* 시안 v7 결정 — desc 제거 (라벨만 표시) + icon-box 시그니처 (별 두 개). */}
        <Toggle
          flat
          icon="stars"
          checked={!skipUpgrade}
          onChange={(v) => setSkipUpgrade(!v)}
          align="right"
          label="🪄 AI 프롬프트 보정"
        />
        {!skipUpgrade && (
          <PromptModeRadio value={promptMode} onChange={setPromptMode} />
        )}
      </V5MotionCard>

      {/* Claude 조사 토글 — V5 시그니처 카드 (.ais-sig-claude · orange).
       *  ResearchBanner 가 옛 단일 Toggle (flat=true) 이라 외부 카드 wrapper 가 색 책임.
       *  Phase 1.5.7 — V5MotionCard 로 spring layout 보간. */}
      <V5MotionCard
        className="ais-toggle-card ais-sig-claude"
        data-active={research}
        onClick={() => setResearch(!research)}
        tooltip="Claude 가 프롬프트를 분석해 개선 힌트를 반영합니다 · 약 +15s"
      >
        <ResearchBanner checked={research} onChange={setResearch} />
      </V5MotionCard>

      {/* 퀄리티 모드 토글 — V5 시그니처 카드 (.ais-sig-fast · lime/cyan).
       *  의미 반전 (2026-04-27): OFF=Lightning 빠름 (기본) / ON=💎 퀄리티 모드 (강화).
       *  라벨 동적 분기 — 토글 상태가 곧 모드 명. store 의 lightning 의미는 그대로 (true=빠름).
       *  data-active 는 "강화" (lightning=false) 시 ON. */}
      <V5MotionCard
        className="ais-toggle-card ais-sig-fast"
        data-active={!lightning}
        onClick={() => applyLightning(!lightning)}
        tooltip="ON 시 Lightning 4-step 끄고 풀 디테일 · 약 4배 느림"
      >
        {/* 시안 v7 결정 — desc 제거. 라벨만 + icon-box (lightning bolt).
         *  시안 매칭 (2026-05-02): 라벨 "💎 퀄리티 모드" 고정 (pair-generate.html:2239).
         *  카드 OFF = Lightning 빠른 모드 사용 중 (기본) / ON = 퀄리티 모드 활성. */}
        <Toggle
          flat
          icon="bolt"
          checked={!lightning}
          onChange={(v) => applyLightning(!v)}
          align="right"
          label="💎 퀄리티 모드"
        />
      </V5MotionCard>

      {/* 사이즈 카드 */}
      <SizeCard
        aspect={aspect}
        sizeLabel={sizeLabel}
        width={width}
        height={height}
        aspectLocked={aspectLocked}
        onAspect={(v) => setAspect(v)}
        onWidth={setWidth}
        onHeight={setHeight}
        onAspectLocked={setAspectLocked}
      />
    </StudioLeftPanel>
  );
}
