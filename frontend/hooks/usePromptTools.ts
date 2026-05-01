/**
 * usePromptTools - 프롬프트 도구 (번역/분리) state + 핸들러 통합 hook.
 *
 * Phase 5 후속 (2026-05-01) — 3 LeftPanel (Generate/Edit/Video) 공통 진입점.
 * 옛 `PromptToolsBar` 컴포넌트를 두 sub 컴포넌트로 쪼개면서 state/핸들러를 hook 으로 추출:
 *  - PromptToolsButtons (textarea 안 우측 도구 버튼)
 *  - PromptToolsResults (textarea 외부 결과 카드)
 *
 * 두 컴포넌트가 *DOM 위치는 다르지만 같은 state 공유* 라 hook 으로 lift up.
 *
 * spec §11 비목표 준수: 사용자 명시 클릭 (Append/Replace) 시에만 textarea 변경.
 * tooltip + 휴리스틱 비활성은 컴포넌트 측 책임 (lib/prompt-language).
 */

"use client";

import { useState } from "react";
import {
  splitPrompt,
  translatePrompt,
  type PromptSection,
  type TranslateDirection,
} from "@/lib/api/prompt-tools";
import { toast } from "@/stores/useToastStore";

/** 도구 호출 진행 상태. null = idle. */
export type PromptToolBusy = "split" | "translate-en" | "translate-ko" | null;

interface TranslationCardState {
  text: string;
  direction: TranslateDirection;
}

export interface UsePromptToolsArgs {
  /** 현재 textarea 의 prompt 값 */
  prompt: string;
  /** prompt 갱신 콜백 */
  onPromptChange: (next: string) => void;
  /** Ollama 모델 override (없으면 백엔드 default) */
  ollamaModel?: string;
  /** disabled 가드 — 페이지 가 generating 중일 때 등 */
  disabled?: boolean;
}

export interface UsePromptToolsReturn {
  /** 현재 진행 중인 도구 (null=idle). 버튼별 spinner 분기에 사용. */
  busy: PromptToolBusy;
  /** 도구 자체가 막혀있는지 (disabled || busy || 빈 prompt). 메뉴/버튼 모두 disabled. */
  blocked: boolean;
  /** trim 된 prompt — 휴리스틱/요청에 공통 사용 */
  trimmedPrompt: string;
  /** 분리 결과 (null = 결과 카드 미노출) */
  sections: PromptSection[] | null;
  /** 번역 결과 (null = 결과 카드 미노출) */
  translation: TranslationCardState | null;
  /** 분리 실행 */
  runSplit: () => Promise<void>;
  /** 번역 실행 (direction 지정) */
  runTranslate: (direction: TranslateDirection) => Promise<void>;
  /** 분리 카드 — 선택 추가 (textarea 끝에 append) */
  appendSections: (texts: string[]) => void;
  /** 분리 카드 — 원본 교체 (선택 카드들로 prompt 통째 교체) */
  replaceFromSections: (texts: string[]) => void;
  /** 번역 카드 — 원본 교체 (한→영 결과를 textarea 에 반영) */
  replaceFromTranslation: (text: string) => void;
  /** 분리 카드 닫기 (sections=null) */
  closeSections: () => void;
  /** 번역 카드 닫기 (translation=null) */
  closeTranslation: () => void;
}

export function usePromptTools(args: UsePromptToolsArgs): UsePromptToolsReturn {
  const { prompt, onPromptChange, ollamaModel, disabled = false } = args;

  const [busy, setBusy] = useState<PromptToolBusy>(null);
  const [sections, setSections] = useState<PromptSection[] | null>(null);
  const [translation, setTranslation] = useState<TranslationCardState | null>(
    null,
  );

  const trimmedPrompt = prompt.trim();
  const blocked = disabled || busy !== null || !trimmedPrompt;

  const runSplit = async () => {
    if (blocked) return;
    setBusy("split");
    try {
      const res = await splitPrompt({ prompt: trimmedPrompt, ollamaModel });
      if (res.fallback || res.sections.length === 0) {
        toast.warn("분리 실패", res.error ?? "원본 유지됩니다.");
        setSections(null);
        return;
      }
      setSections(res.sections);
      toast.success("분리 완료", `${res.sections.length}개 카드`);
    } catch (err) {
      toast.error(
        "분리 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
      setSections(null);
    } finally {
      setBusy(null);
    }
  };

  const runTranslate = async (direction: TranslateDirection) => {
    if (blocked) return;
    setBusy(direction === "en" ? "translate-en" : "translate-ko");
    try {
      const res = await translatePrompt({
        prompt: trimmedPrompt,
        direction,
        ollamaModel,
      });
      if (res.fallback || !res.translated) {
        toast.warn("번역 실패", res.error ?? "원본 유지됩니다.");
        setTranslation(null);
        return;
      }
      setTranslation({ text: res.translated, direction });
      toast.success(
        direction === "en" ? "번역 완료 (한→영)" : "번역 완료 (영→한)",
        "카드 확인 후 [원본 교체] / [복사]",
      );
    } catch (err) {
      toast.error(
        "번역 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
      setTranslation(null);
    } finally {
      setBusy(null);
    }
  };

  const appendSections = (texts: string[]) => {
    if (texts.length === 0) return;
    const joined = texts.join(", ");
    const next = trimmedPrompt
      ? `${trimmedPrompt.replace(/\s+$/, "")}, ${joined}`
      : joined;
    onPromptChange(next);
    toast.success("카드 추가", `${texts.length}개 phrase 추가됨`);
  };

  const replaceFromSections = (texts: string[]) => {
    if (texts.length === 0) return;
    onPromptChange(texts.join(", "));
    toast.success("원본 교체", `${texts.length}개 phrase 로 교체됨`);
    setSections(null);
  };

  const replaceFromTranslation = (text: string) => {
    onPromptChange(text);
    toast.success("원본 교체", "번역 결과로 교체됨");
    setTranslation(null);
  };

  return {
    busy,
    blocked,
    trimmedPrompt,
    sections,
    translation,
    runSplit,
    runTranslate,
    appendSections,
    replaceFromSections,
    replaceFromTranslation,
    closeSections: () => setSections(null),
    closeTranslation: () => setTranslation(null),
  };
}
