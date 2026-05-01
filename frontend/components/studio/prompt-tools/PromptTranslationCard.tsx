/**
 * PromptTranslationCard - 번역 결과 카드 (Phase 5 후속 · Codex 리뷰 High fix).
 *
 * spec §6.5: "분리 결과 카드는 원본 아래에 표시한다 / 카드 액션: 복사, 원본에 적용,
 * 카드 삭제, 원본 유지". 번역도 동일 패턴이어야 사용자가 비교/복사/적용 가능.
 *
 * 옛 동작 (Codex High finding):
 *  - 한→영: textarea 즉시 교체 → 원문 즉시 손실 (사용자 후회 X)
 *  - 영→한: 200자 토스트 → 비교/복사 불가
 *
 * 신규 동작:
 *  - 양방향 모두 결과를 *카드* 로 노출.
 *  - 카드 액션: 복사 / 원본 교체 (명시 확정) / 닫기 (원본 유지).
 *  - 영→한 결과는 '원본 교체' 비활성 (모델은 영문 받아야 — 사용자 확인 용 only).
 */

"use client";

import { memo } from "react";
import type { TranslateDirection } from "@/lib/api/prompt-tools";

interface Props {
  /** 번역 결과 텍스트 (이미 fallback 검증 완료된 값) */
  translated: string;
  direction: TranslateDirection;
  /** 카드 닫기 (원본 유지) */
  onClose: () => void;
  /** 결과로 원본 prompt 통째 교체 — direction='ko' 일 때는 호출자가 disable. */
  onReplace?: (text: string) => void;
}

const DIRECTION_LABEL: Record<TranslateDirection, string> = {
  en: "한→영 번역",
  ko: "영→한 번역",
};

function PromptTranslationCardImpl({
  translated,
  direction,
  onClose,
  onReplace,
}: Props) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(translated);
    } catch {
      // silent — 호출자가 토스트 책임
    }
  };

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
        <span>🌐 {DIRECTION_LABEL[direction]} 결과</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="번역 카드 닫기 (원본 유지)"
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

      <div
        style={{
          padding: "10px 12px",
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--ink)",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 6,
          maxHeight: 240,
          overflowY: "auto",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {translated}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          onClick={handleCopy}
          aria-label="번역 결과 복사"
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 6,
            border: "1px solid var(--line)",
            background: "transparent",
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          복사
        </button>
        {onReplace && direction === "en" && (
          <button
            type="button"
            onClick={() => onReplace(translated)}
            title="번역 결과로 원본 prompt 통째 교체"
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: "1px solid var(--accent, rgba(99,102,241,0.6))",
              background: "var(--accent-soft, rgba(99,102,241,0.18))",
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            원본 교체
          </button>
        )}
        {direction === "ko" && (
          <span
            style={{
              alignSelf: "center",
              fontSize: 11,
              color: "var(--ink-4)",
              padding: "0 4px",
            }}
            title="모델은 영문 프롬프트를 받아야 하므로 한국어 번역은 확인용입니다."
          >
            확인용 · 모델 입력 X
          </span>
        )}
      </div>
    </div>
  );
}

const PromptTranslationCard = memo(PromptTranslationCardImpl);
export default PromptTranslationCard;
