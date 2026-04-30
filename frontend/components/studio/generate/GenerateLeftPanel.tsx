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
  removeMarker,
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
  } = useGenerateInputs();
  const { generating, progress, stage } = useGenerateRunning();

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

  // 카드 클릭 → textarea toggle + 모달 자동 닫기 + 커서 위치 삽입.
  // 2026-04-30 (오빠 후속 피드백):
  //   - 카드 선택 시 LibraryModal 자동 닫기
  //   - 새 마커는 textarea 의 *현재 커서 위치* 에 삽입 (selection 영역 있으면 교체)
  //   - 이미 마커 있으면 토글 제거 (그 자리에 모달 닫고 focus 만)
  const handleToggleSnippet = (snip: PromptSnippet) => {
    const closeAndFocus = (newCursor?: number) => {
      setLibraryOpen(false);
      // setPrompt 가 다음 렌더에서 textarea value 갱신하므로 rAF 로 cursor 복원.
      requestAnimationFrame(() => {
        const ta = promptTextareaRef.current;
        if (!ta) return;
        ta.focus();
        if (typeof newCursor === "number") {
          ta.setSelectionRange(newCursor, newCursor);
        }
      });
    };

    // 1. 이미 마커 있으면 제거 (전체 textarea 에서 첫 매치 1회)
    if (hasMarker(prompt, snip.prompt)) {
      setPrompt(removeMarker(prompt, snip.prompt));
      closeAndFocus();
      return;
    }

    // 2. 새 마커 삽입 — 커서 위치 우선
    const wrapped = wrapMarker(snip.prompt);
    const ta = promptTextareaRef.current;

    // ref 없거나 selection 정보 못 받으면 끝에 추가 (폴백)
    if (!ta || ta.selectionStart == null) {
      if (!prompt.trim()) {
        setPrompt(wrapped);
        closeAndFocus(wrapped.length);
      } else {
        const next = `${prompt.trimEnd()}, ${wrapped}`;
        setPrompt(next);
        closeAndFocus(next.length);
      }
      return;
    }

    // 커서 위치 / selection 영역 삽입
    const start = ta.selectionStart;
    const end = ta.selectionEnd ?? start;
    const before = prompt.slice(0, start);
    const after = prompt.slice(end);

    // 자연스러운 separator: before 끝이 콤마/공백 아니면 ", " 자동 삽입.
    const beforeNeedsSep = before.length > 0 && !/[,\s]$/.test(before);
    const afterNeedsSep = after.length > 0 && !/^[,\s]/.test(after);
    const insert = `${beforeNeedsSep ? ", " : ""}${wrapped}${afterNeedsSep ? ", " : ""}`;

    setPrompt(before + insert + after);
    closeAndFocus(before.length + insert.length);
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
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            프롬프트
          </label>
          <span className="mono ais-field-meta">
            {prompt.length} chars · KO
          </span>
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
          <div className="ais-prompt-footer">
            <div style={{ display: "flex", gap: 8 }}>
              {/* 2026-04-30 (오빠 후속 UX 정리):
               *  [+ 라이브러리에 등록] / [템플릿 저장] 별도 버튼 제거.
               *  → 라이브러리 모달 안 [+ 새 등록] 이 currentPrompt 자동 pre-fill 로 흡수.
               */}
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                className="ais-prompt-link"
                title="프롬프트 라이브러리 (등록도 모달 안에서)"
              >
                📚 라이브러리
              </button>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setPrompt("")}
                title="프롬프트 비우기"
                className="ais-prompt-clear"
              >
                <Icon name="x" size={10} /> 비우기
              </button>
            </div>
          </div>
        </div>
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
