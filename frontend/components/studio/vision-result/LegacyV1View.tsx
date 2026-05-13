/**
 * vision-result/LegacyV1View — 옛 row (positivePrompt 빈) 폴백 카드.
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 *
 * 기존 영/한 탭 + 단락 디자인 그대로 보존 — DB v1 row 자동 호환.
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { SmallBtn } from "@/components/ui/primitives";
import { toast } from "@/stores/useToastStore";
import type { VisionCardResult } from "@/components/studio/VisionContent";

export default function LegacyV1View({ result }: { result: VisionCardResult }) {
  const [lang, setLang] = useState<"en" | "ko">("en");

  const enText = result.en || "";
  const koText = result.ko ?? "";
  const koFailed = result.ko === null;
  const activeText = lang === "en" ? enText : koText;

  const handleCopy = async () => {
    if (!activeText) {
      toast.warn("복사할 내용이 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(activeText);
      toast.success(
        `${lang === "en" ? "영문" : "한글"} 복사됨`,
        `${activeText.length} chars`,
      );
    } catch (err) {
      toast.error("복사 실패", err instanceof Error ? err.message : "");
    }
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--line)",
          gap: 8,
        }}
      >
        <div
          role="tablist"
          aria-label="결과 언어 선택"
          style={{
            display: "inline-flex",
            background: "var(--bg-2)",
            borderRadius: "var(--radius-sm)",
            padding: 2,
            gap: 2,
          }}
        >
          {(["en", "ko"] as const).map((l) => {
            const active = lang === l;
            const disabled = l === "ko" && koFailed;
            return (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => !disabled && setLang(l)}
                disabled={disabled}
                style={{
                  all: "unset",
                  cursor: disabled ? "not-allowed" : "pointer",
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: "var(--radius-sm)",
                  color: active
                    ? "var(--ink)"
                    : disabled
                      ? "var(--ink-4)"
                      : "var(--ink-3)",
                  background: active ? "var(--surface)" : "transparent",
                  boxShadow: active ? "var(--shadow-sm)" : "none",
                  opacity: disabled ? 0.5 : 1,
                }}
                title={disabled ? "번역 실패" : ""}
              >
                {l === "en" ? "영문" : "한글"}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-4)" }}
          >
            {activeText.length} chars · v1
          </span>
          <SmallBtn icon="copy" onClick={handleCopy}>
            복사
          </SmallBtn>
        </div>
      </div>
      <div
        style={{
          padding: "16px 18px",
          fontSize: 13.5,
          lineHeight: 1.65,
          color: "var(--ink)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          minHeight: 120,
        }}
      >
        {activeText ? (
          activeText
        ) : (
          <span
            style={{
              color: "var(--ink-4)",
              fontSize: 12.5,
              fontStyle: "italic",
            }}
          >
            {lang === "ko" && koFailed
              ? "한글 번역 실패. 영문 탭에서 결과 확인."
              : "결과 없음"}
          </span>
        )}
      </div>
      {!enText && (
        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--line)",
            background: "var(--amber-soft)",
            fontSize: 11.5,
            color: "var(--amber-ink)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="search" size={12} />
          Ollama 비전 호출이 실패했습니다. 상태 확인 후 다시 시도해 주세요.
        </div>
      )}
    </div>
  );
}
