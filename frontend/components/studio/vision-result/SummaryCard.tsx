/**
 * vision-result/SummaryCard — 한/영 토글이 가능한 Summary 카드.
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { SmallBtn } from "@/components/ui/primitives";
import { toast } from "@/stores/useToastStore";

interface Props {
  en: string;
  ko: string;
  koFailed: boolean;
}

export default function SummaryCard({ en, ko, koFailed }: Props) {
  const [lang, setLang] = useState<"ko" | "en">(ko ? "ko" : "en");
  const text = lang === "ko" ? ko : en;
  const koDisabled = !ko || koFailed;

  const onCopy = async () => {
    if (!text) {
      toast.warn("복사할 내용이 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("요약 복사됨", `${text.length} chars`);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="sparkle" size={13} style={{ color: "var(--ink-3)" }} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink-2)",
              letterSpacing: ".04em",
              textTransform: "uppercase",
            }}
          >
            요약
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            role="tablist"
            style={{
              display: "inline-flex",
              background: "var(--bg-2)",
              borderRadius: "var(--radius-sm)",
              padding: 2,
              gap: 2,
            }}
          >
            {(["ko", "en"] as const).map((l) => {
              const active = lang === l;
              const disabled = l === "ko" && koDisabled;
              return (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={disabled}
                  onClick={() => !disabled && setLang(l)}
                  style={{
                    all: "unset",
                    cursor: disabled ? "not-allowed" : "pointer",
                    padding: "4px 10px",
                    fontSize: 11.5,
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
                  title={disabled ? "한글 번역 실패" : ""}
                >
                  {l === "ko" ? "한글" : "영문"}
                </button>
              );
            })}
          </div>
          <SmallBtn icon="copy" onClick={onCopy}>
            복사
          </SmallBtn>
        </div>
      </div>
      <div
        style={{
          padding: "12px 14px",
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--ink)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          minHeight: 60,
        }}
      >
        {text || (
          <span
            style={{
              color: "var(--ink-4)",
              fontStyle: "italic",
              fontSize: 12,
            }}
          >
            {koDisabled && lang === "ko"
              ? "한글 번역 실패 — 영문 탭에서 확인."
              : "결과 없음"}
          </span>
        )}
      </div>
    </div>
  );
}
