/**
 * PromptToolsBar - 프롬프트 도구 (번역 / 분리) 진입점.
 *
 * Phase 5 (2026-05-01) 신설.
 * Codex Phase 5 리뷰 fix:
 *  - High: 번역 결과를 *카드* 로 노출 (옛 즉시 교체/200자 토스트 → 명시 [원본 교체] / [복사] / [닫기])
 *  - Medium: ollamaModel override prop 받아 splitPrompt/translatePrompt 에 전달
 *  - Low: 분리 카드 액션 분리 — [선택 추가] (append) + [원본 교체] (replace)
 *
 * spec §11 비목표 준수: 분리/번역 결과로 원본 textarea 자동 덮지 않음.
 *  - 사용자 명시 클릭 (Append/Replace) 시에만 textarea 변경.
 */

"use client";

import { memo, useState } from "react";
import {
  splitPrompt,
  translatePrompt,
  type PromptSection,
  type TranslateDirection,
} from "@/lib/api/prompt-tools";
import { toast } from "@/stores/useToastStore";
import PromptCardList from "./PromptCardList";
import PromptTranslationCard from "./PromptTranslationCard";

interface Props {
  /** 현재 textarea 의 prompt 값 (입력) */
  prompt: string;
  /** prompt 갱신 콜백 — Append (append) / Replace (전체 교체) */
  onPromptChange: (next: string) => void;
  /** Ollama 모델 override (Codex Phase 5 fix Medium — 옛엔 안 받아 백엔드 default 만 썼음).
   *  설정 패널의 ollamaModel 을 그대로 패스스루. undefined 면 백엔드 기본값. */
  ollamaModel?: string;
  /** disabled 가드 — 페이지 가 generating 중일 때 등 */
  disabled?: boolean;
}

type ToolBusy = "split" | "translate-en" | "translate-ko" | null;

interface TranslationCardState {
  text: string;
  direction: TranslateDirection;
}

function PromptToolsBarImpl({
  prompt,
  onPromptChange,
  ollamaModel,
  disabled = false,
}: Props) {
  const [busy, setBusy] = useState<ToolBusy>(null);
  const [sections, setSections] = useState<PromptSection[] | null>(null);
  // Codex Phase 5 fix High — 번역 결과는 카드로 노출 (옛 즉시 교체 X)
  const [translation, setTranslation] = useState<TranslationCardState | null>(
    null,
  );

  const trimmed = prompt.trim();
  const blocked = disabled || busy !== null || !trimmed;

  const handleSplit = async () => {
    if (blocked) return;
    setBusy("split");
    try {
      const res = await splitPrompt({ prompt: trimmed, ollamaModel });
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
        prompt: trimmed,
        direction,
        ollamaModel,
      });
      if (res.fallback || !res.translated) {
        toast.warn("번역 실패", res.error ?? "원본 유지됩니다.");
        setTranslation(null);
        return;
      }
      // Codex Phase 5 fix High — 결과를 카드로 보여주고 사용자가 명시 [원본 교체] 클릭.
      // 옛: 한→영은 즉시 교체 (원문 즉시 손실), 영→한은 200자 토스트 (비교/복사 불가).
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

  // 분리 카드 — 선택 추가 (textarea 끝에 append, 기존 prompt 보존)
  const handleAppend = (texts: string[]) => {
    if (texts.length === 0) return;
    const joined = texts.join(", ");
    const next = trimmed ? `${trimmed.replace(/\s+$/, "")}, ${joined}` : joined;
    onPromptChange(next);
    toast.success("카드 추가", `${texts.length}개 phrase 추가됨`);
  };

  // 분리 카드 — 원본 교체 (선택 카드들로 prompt 통째 교체 · destructive)
  const handleReplaceFromSections = (texts: string[]) => {
    if (texts.length === 0) return;
    onPromptChange(texts.join(", "));
    toast.success("원본 교체", `${texts.length}개 phrase 로 교체됨`);
    setSections(null);
  };

  // 번역 카드 — 원본 교체 (한→영 결과를 textarea 에 반영)
  const handleTranslationReplace = (text: string) => {
    onPromptChange(text);
    toast.success("원본 교체", "번역 결과로 교체됨");
    setTranslation(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          fontSize: 12,
        }}
      >
        <ToolButton
          onClick={() => runTranslate("en")}
          disabled={blocked}
          busy={busy === "translate-en"}
          label="한→영"
          title="한국어 프롬프트 → 영문 (Stable Diffusion 호환)"
        />
        <ToolButton
          onClick={() => runTranslate("ko")}
          disabled={blocked}
          busy={busy === "translate-ko"}
          label="영→한"
          title="영문 프롬프트 → 한국어 (확인용)"
        />
        <ToolButton
          onClick={handleSplit}
          disabled={blocked}
          busy={busy === "split"}
          label="📑 분리"
          title="긴 프롬프트를 카테고리 카드로 분리"
        />
      </div>
      {translation && (
        <PromptTranslationCard
          translated={translation.text}
          direction={translation.direction}
          onClose={() => setTranslation(null)}
          onReplace={handleTranslationReplace}
        />
      )}
      {sections && (
        <PromptCardList
          sections={sections}
          onAppend={handleAppend}
          onReplace={handleReplaceFromSections}
          onClose={() => setSections(null)}
        />
      )}
    </div>
  );
}

function ToolButton({
  onClick,
  disabled,
  busy,
  label,
  title,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        padding: "5px 10px",
        fontSize: 12,
        fontWeight: 500,
        borderRadius: 6,
        border: "1px solid var(--line)",
        background: busy
          ? "var(--accent-soft, rgba(99,102,241,0.18))"
          : "var(--surface-2, rgba(255,255,255,0.02))",
        color: disabled ? "var(--ink-5)" : "var(--ink-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 120ms",
      }}
    >
      {busy ? "…" : label}
    </button>
  );
}

const PromptToolsBar = memo(PromptToolsBarImpl);
export default PromptToolsBar;
