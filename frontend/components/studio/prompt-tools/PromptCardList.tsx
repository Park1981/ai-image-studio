/**
 * PromptCardList - 프롬프트 분리 결과 카드 리스트.
 *
 * Phase 5 (2026-05-01) 신설.
 *
 * spec §6.5 의 카드 액션:
 *  - 복사 (clipboard)
 *  - 원본에 적용 (선택 카드들의 text 를 textarea 끝에 추가)
 *  - 카드 삭제 (해당 카드만 리스트에서 제거)
 *  - 원본 유지 (= 닫기 버튼)
 *
 * spec §11 비목표: "분리 결과로 원본을 자동 덮어쓰지 않는다".
 *  - 사용자가 [선택 적용] / [모두 적용] 명시 클릭 시에만 textarea 변경.
 *  - 자동 mount-effect 등으로 prompt 를 만지지 않는다.
 */

"use client";

import { memo, useState } from "react";
import type { PromptSection, PromptSectionKey } from "@/lib/api/prompt-tools";

interface Props {
  sections: PromptSection[];
  /** 선택 카드들의 text 를 textarea 끝에 추가. ", " 로 join. */
  onApply: (texts: string[]) => void;
  /** "원본 유지" / 닫기 — 카드 영역 자체 숨김 */
  onClose: () => void;
}

/** 카테고리 한국어 라벨 — UI 가독성용. 백엔드 key 는 영어 (모델 호환). */
const KEY_LABEL_KO: Record<PromptSectionKey, string> = {
  subject: "주제",
  composition: "구도",
  face: "얼굴",
  eyes: "눈",
  nose: "코",
  lips: "입술",
  skin: "피부",
  makeup: "메이크업",
  expression: "표정",
  hair: "머리",
  outfit: "의상",
  background: "배경",
  lighting: "조명",
  style: "스타일",
  quality: "퀄리티",
  negative: "네거티브",
  etc: "기타",
};

function PromptCardListImpl({ sections, onApply, onClose }: Props) {
  // 선택 상태 — 모든 카드 기본 선택 (선택적용 누르면 그 카드들만 textarea 추가)
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(sections.map((_, i) => i)),
  );
  // 삭제된 카드 (UI 만 — 다시 분리 누르면 새 결과로 갱신)
  const [deleted, setDeleted] = useState<Set<number>>(() => new Set());

  const toggleSelect = (idx: number) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleDelete = (idx: number) => {
    setDeleted((cur) => new Set(cur).add(idx));
    setSelected((cur) => {
      const next = new Set(cur);
      next.delete(idx);
      return next;
    });
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API 실패는 silent — 토스트는 호출자 책임 (필요 시)
    }
  };

  const visibleEntries = sections
    .map((section, idx) => ({ section, idx }))
    .filter(({ idx }) => !deleted.has(idx));

  if (visibleEntries.length === 0) {
    return null;
  }

  const selectedTexts = visibleEntries
    .filter(({ idx }) => selected.has(idx))
    .map(({ section }) => section.text);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--line)",
        background: "var(--surface, rgba(255,255,255,0.02))",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        <span>📑 분리된 카드 {visibleEntries.length}개 · 선택 {selectedTexts.length}개</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="카드 닫기 (원본 유지)"
          style={{
            padding: "2px 8px",
            fontSize: 11,
            borderRadius: 4,
            border: "1px solid var(--line)",
            background: "transparent",
            color: "var(--ink-3)",
            cursor: "pointer",
          }}
        >
          닫기
        </button>
      </div>

      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {visibleEntries.map(({ section, idx }) => {
          const isSelected = selected.has(idx);
          const labelKo = KEY_LABEL_KO[section.key] ?? section.key;
          return (
            <li
              key={idx}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                background: isSelected
                  ? "var(--accent-soft, rgba(99,102,241,0.08))"
                  : "var(--surface-2, rgba(255,255,255,0.02))",
                border: "1px solid var(--line)",
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleSelect(idx)}
                aria-label={`${labelKo} 카드 선택`}
                style={{ marginTop: 3 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-4)",
                    marginBottom: 2,
                    fontWeight: 600,
                  }}
                >
                  {labelKo}{" "}
                  <span style={{ color: "var(--ink-5)", fontWeight: 400 }}>
                    ({section.key})
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: "var(--ink)",
                    wordBreak: "break-word",
                  }}
                >
                  {section.text}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => handleCopy(section.text)}
                  aria-label={`${labelKo} 복사`}
                  title="복사"
                  style={{
                    padding: "2px 8px",
                    fontSize: 11,
                    borderRadius: 4,
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--ink-3)",
                    cursor: "pointer",
                  }}
                >
                  복사
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(idx)}
                  aria-label={`${labelKo} 카드 삭제`}
                  title="이 카드 삭제"
                  style={{
                    padding: "2px 8px",
                    fontSize: 11,
                    borderRadius: 4,
                    border: "1px solid var(--line)",
                    background: "transparent",
                    color: "var(--ink-4)",
                    cursor: "pointer",
                  }}
                >
                  삭제
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 4,
        }}
      >
        <button
          type="button"
          onClick={() => onApply(selectedTexts)}
          disabled={selectedTexts.length === 0}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
            border: "1px solid var(--accent, rgba(99,102,241,0.6))",
            background: "var(--accent-soft, rgba(99,102,241,0.18))",
            color: "var(--ink)",
            cursor: selectedTexts.length === 0 ? "not-allowed" : "pointer",
            opacity: selectedTexts.length === 0 ? 0.5 : 1,
          }}
        >
          선택 적용 ({selectedTexts.length})
        </button>
      </div>
    </div>
  );
}

const PromptCardList = memo(PromptCardListImpl);
export default PromptCardList;
