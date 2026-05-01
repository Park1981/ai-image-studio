/**
 * PromptToolsBar - 프롬프트 도구 (번역 / 분리) 진입점.
 *
 * Phase 5 (2026-05-01) 신설.
 *
 * spec §6.5:
 *   [번역] [분리] 버튼 — Generate/Edit/Video LeftPanel 의 prompt textarea 아래.
 *
 * 상호작용:
 *  - [번역 한→영]: 한국어 prompt → 영문. 결과를 textarea 에 *append* (덮어쓰기 X).
 *  - [번역 영→한]: 영문 prompt → 한국어. 결과는 토스트로만 보여주고 textarea 안 건드림
 *    (한국어 텍스트를 모델에 보낼 일 없음 — 단순 사용자 확인 용).
 *  - [분리]: PromptSplitResponse 받아 PromptCardList 컴포넌트로 노출.
 *  - 모든 호출 동안 spinner + 버튼 disabled.
 *
 * spec §11 비목표: 분리 결과로 원본 textarea 자동 덮어쓰지 않음 — 카드 안의 [선택 적용]
 * 클릭 시에만 textarea 끝에 phrase append.
 */

"use client";

import { memo, useState } from "react";
import {
  splitPrompt,
  translatePrompt,
  type PromptSection,
} from "@/lib/api/prompt-tools";
import { toast } from "@/stores/useToastStore";
import PromptCardList from "./PromptCardList";

interface Props {
  /** 현재 textarea 의 prompt 값 (입력) */
  prompt: string;
  /** prompt 갱신 콜백 — onApply 시 textarea 끝에 phrase append */
  onPromptChange: (next: string) => void;
  /** Ollama 모델 override (없으면 백엔드 기본값) */
  ollamaModel?: string;
  /** disabled 가드 — 페이지 가 generating 중일 때 등 */
  disabled?: boolean;
}

type ToolBusy = "split" | "translate-en" | "translate-ko" | null;

function PromptToolsBarImpl({
  prompt,
  onPromptChange,
  ollamaModel,
  disabled = false,
}: Props) {
  const [busy, setBusy] = useState<ToolBusy>(null);
  const [sections, setSections] = useState<PromptSection[] | null>(null);

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

  const runTranslate = async (direction: "ko" | "en") => {
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
        return;
      }
      if (direction === "en") {
        // 한→영: textarea 의 한국어 prompt 를 영문으로 *교체* (사용자 의도 — 모델에
        // 영문 보내야 하므로). textarea 가 비어있을 때 호출됐으면 append 와 동치.
        onPromptChange(res.translated);
        toast.success("번역 완료 (한→영)", "프롬프트가 영문으로 교체됐습니다.");
      } else {
        // 영→한: 한국어 결과는 textarea 에 안 넣음 (모델 호환 영문 그대로 유지).
        // 사용자 확인용 — 토스트 + 길면 콘솔에 풀버전 출력.
        toast.info(
          "번역 완료 (영→한)",
          res.translated.length > 200
            ? `${res.translated.slice(0, 200)}…`
            : res.translated,
        );
      }
    } catch (err) {
      toast.error(
        "번역 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleApply = (texts: string[]) => {
    if (texts.length === 0) return;
    const joined = texts.join(", ");
    const next = trimmed ? `${trimmed.replace(/\s+$/, "")}, ${joined}` : joined;
    onPromptChange(next);
    toast.success("카드 적용", `${texts.length}개 phrase 추가됨`);
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
      {sections && (
        <PromptCardList
          sections={sections}
          onApply={handleApply}
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
