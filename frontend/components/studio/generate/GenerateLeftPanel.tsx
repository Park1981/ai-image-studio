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

import { useEffect, useRef, useState, type RefObject } from "react";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import PromptModeRadio from "@/components/studio/PromptModeRadio";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import PromptToolsResults from "@/components/studio/prompt-tools/PromptToolsResults";
import { usePromptTools } from "@/hooks/usePromptTools";
import ResearchBanner from "@/components/studio/ResearchBanner";
import SnippetLibraryModal from "@/components/studio/SnippetLibraryModal";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import {
  StudioLeftPanel,
  StudioModeHeader,
} from "@/components/studio/StudioLayout";
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

  // Phase 2 (2026-05-01) — settings 의 promptEnhanceMode 를 *마운트 시 1회만* store 로 sync.
  // Codex Phase 4 리뷰 Medium #2 fix: settings 변경이 페이지 session 토글을 즉시 덮어쓰던
  // 옛 동작 차단. settings 변경 효과는 페이지 재진입 시점부터 반영 (= "session-only" 정책 정합).
  // ref 로 mount 1회만 실행 — settings 값이 바뀌어도 effect 재실행 안 함.
  const promptModeInitRef = useRef(false);
  useEffect(() => {
    if (promptModeInitRef.current) return;
    promptModeInitRef.current = true;
    setPromptMode(useSettingsStore.getState().promptEnhanceMode);
  }, [setPromptMode]);

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
        title="Image Generate"
        description="프롬프트를 다듬고 로컬 ComfyUI로 이미지를 생성합니다."
        flowHref="/prompt-flow/generate"
        flowLabel="이 모드의 프롬프트 흐름 보기 (분기 트리)"
      />

      {/* Primary CTA — sticky 상단 (폼 길어지면 따라옴 · generate 전용 클래스) */}
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
              생성
              <span className="mono ais-cta-shortcut">⇧↵</span>
            </>
          )}
        </button>

        <div className="ais-cta-eta">
          평균 소요{" "}
          <span className="mono">~{research ? "42" : "28"}s</span> · 로컬
          처리 · 데이터 전송 없음
        </div>
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

      {/* AI 프롬프트 보정 토글 (2026-04-27 오빠 피드백):
       *  사용자 직관 매칭 — 토글 ON=기능 ON / OFF=기능 OFF.
       *    ON  (기본 · skipUpgrade=false) → gemma4 실행 (보정 ON)
       *    OFF (skipUpgrade=true)         → gemma4 skip (정제된 프롬프트 그대로)
       *  Lightning 의 의미 반전 + 라벨 동적 패턴은 "빠른/퀄리티" 모드 선택이라 자연스러웠지만,
       *  보정 토글은 단순 기능 ON/OFF 라 직관 따르는 게 옳음 (오빠 피드백).
       */}
      {/* AI 보정 카드 — 토글 + (ON 일 때만) instant/thinking segmented 통합.
       *  Phase 2 후속 (2026-05-01) — 옛: Toggle + 별도 PromptModeRadio 카드 두 개 분리.
       *  신: 하나의 카드 wrap 안에 Toggle 위 + segmented 아래 (오빠 디자인 피드백). */}
      <div className="ais-magic-prompt-card">
        <Toggle
          checked={!skipUpgrade}
          onChange={(v) => setSkipUpgrade(!v)}
          align="right"
          label="🪄 AI 프롬프트 보정"
          desc={
            skipUpgrade
              ? "OFF · 프롬프트 그대로 사용 (~10초 절약)"
              : "ON · 한국어/자연어 → 영문 정제 (기본)"
          }
        />
        {!skipUpgrade && (
          <PromptModeRadio value={promptMode} onChange={setPromptMode} />
        )}
      </div>

      {/* Claude 조사 토글 — Lightning 과 동일 패턴 (우측 토글 · amber 톤) */}
      <ResearchBanner checked={research} onChange={setResearch} />

      {/* 퀄리티 모드 토글 — 우측 토글 (settings 패턴 · ResearchBanner 와 통일).
       *  의미 반전 (2026-04-27 오빠 피드백): OFF 가 기본 빠름 / ON 이 강화 옵션 (퀄리티).
       *  라벨 동적 분기 — 토글 상태가 곧 모드 명 (오빠 직관 매칭 · 2026-04-27 후속):
       *    OFF (기본 · lightning=true)  → ⚡ 빠른 모드
       *    ON  (강화 · lightning=false) → 💎 퀄리티 모드
       *  store 의 lightning 의미는 그대로 (true=Lightning LoRA ON=빠름) — UI 만 반전.
       */}
      <Toggle
        checked={!lightning}
        onChange={(v) => applyLightning(!v)}
        align="right"
        label={lightning ? "⚡ 빠른 모드" : "💎 퀄리티 모드"}
        desc={
          lightning
            ? "Lightning 4-step · 약 4배 빠름 (기본)"
            : "Lightning OFF · 풀 퀄리티 · 약 4배 느림"
        }
      />

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
