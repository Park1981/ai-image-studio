/**
 * PromptToolsResults - 프롬프트 도구 결과 카드 wrapper.
 *
 * Phase 5 후속 (2026-05-01) — `.ais-prompt-shell` 외부 (textarea 아래 sibling) 위치.
 * 도구 버튼 (PromptToolsButtons · textarea 안) 과 짝. 둘 다 같은 usePromptTools hook 의
 * state 공유.
 *
 * 결과 도착 시 자연스럽게 카드 펼침 — translation 우선, sections 다음.
 * 둘 다 null 이면 자체 unmount (DOM 노드 0).
 */

"use client";

import type { UsePromptToolsReturn } from "@/hooks/usePromptTools";
import PromptCardList from "./PromptCardList";
import PromptTranslationCard from "./PromptTranslationCard";

interface Props {
  tools: UsePromptToolsReturn;
}

export default function PromptToolsResults({ tools }: Props) {
  const {
    translation,
    sections,
    closeTranslation,
    closeSections,
    appendSections,
    replaceFromSections,
    replaceFromTranslation,
  } = tools;

  if (!translation && !sections) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {translation && (
        <PromptTranslationCard
          translated={translation.text}
          direction={translation.direction}
          onClose={closeTranslation}
          onReplace={replaceFromTranslation}
        />
      )}
      {sections && (
        <PromptCardList
          sections={sections}
          onAppend={appendSections}
          onReplace={replaceFromSections}
          onClose={closeSections}
        />
      )}
    </div>
  );
}
