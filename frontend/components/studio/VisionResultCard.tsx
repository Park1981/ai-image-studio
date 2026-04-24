/**
 * VisionResultCard — 분석 결과 표시 (영/한 탭 + 복사 버튼).
 * 2026-04-24 · C4.
 *
 * 3 상태:
 *  - loading (running=true): Spinner + "분석 중…"
 *  - empty (result=null, running=false): 안내 메시지
 *  - filled (result 존재): 세그먼트 탭 + 텍스트 + 복사 버튼
 *
 * 복사 동작은 내부에서 처리 (navigator.clipboard.writeText + 토스트).
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { SmallBtn } from "@/components/ui/primitives";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioLoadingState from "@/components/studio/StudioLoadingState";
import { toast } from "@/stores/useToastStore";

interface Props {
  /** { en, ko } 또는 null (아직 분석 안 함) */
  result: { en: string; ko: string | null } | null;
  running: boolean;
}

type Lang = "en" | "ko";

export default function VisionResultCard({ result, running }: Props) {
  const [lang, setLang] = useState<Lang>("en");

  const handleCopy = async (text: string, label: string) => {
    if (!text) {
      toast.warn("복사할 내용이 없습니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} 복사됨`, `${text.length} chars`);
    } catch (err) {
      toast.error("복사 실패", err instanceof Error ? err.message : "");
    }
  };

  // ─── Loading ─── (audit R2-9: 공통 StudioLoadingState 로 교체)
  if (running) {
    return (
      <StudioLoadingState
        title="분석 중…"
        description="비전 모델 호출 + 한글 번역 2단계"
      />
    );
  }

  // ─── Empty ─── (audit R2-9: 공통 StudioEmptyState 로 교체)
  if (!result) {
    return (
      <StudioEmptyState size="normal">
        이미지를 업로드하고 <b>분석</b> 버튼을 눌러 주세요.
      </StudioEmptyState>
    );
  }

  // ─── Filled ───
  const enText = result.en || "";
  const koText = result.ko ?? "";
  const koFailed = result.ko === null;
  const activeText = lang === "en" ? enText : koText;

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
      {/* 상단 바: 탭 + 복사 */}
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
        {/* 언어 탭 */}
        <div
          role="tablist"
          aria-label="결과 언어 선택"
          style={{
            display: "inline-flex",
            background: "var(--bg-2)",
            borderRadius: 8,
            padding: 2,
            gap: 2,
          }}
        >
          {(["en", "ko"] as const).map((l) => {
            const active = lang === l;
            const label = l === "en" ? "영문" : "한글";
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
                  borderRadius: 6,
                  color: active
                    ? "var(--ink)"
                    : disabled
                      ? "var(--ink-4)"
                      : "var(--ink-3)",
                  background: active ? "var(--surface)" : "transparent",
                  boxShadow: active ? "var(--shadow-sm)" : "none",
                  letterSpacing: "-0.005em",
                  opacity: disabled ? 0.5 : 1,
                }}
                title={disabled ? "번역 실패 — 영문만 사용 가능" : ""}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* 복사 버튼 + 글자 수 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-4)" }}
          >
            {activeText.length} chars
          </span>
          <SmallBtn
            icon="copy"
            onClick={() =>
              handleCopy(activeText, lang === "en" ? "영문" : "한글")
            }
          >
            복사
          </SmallBtn>
        </div>
      </div>

      {/* 본문 */}
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
            style={{ color: "var(--ink-4)", fontSize: 12.5, fontStyle: "italic" }}
          >
            {lang === "ko" && koFailed
              ? "한글 번역 실패. 영문 탭에서 결과 확인."
              : "결과 없음"}
          </span>
        )}
      </div>

      {/* fallback=true 힌트 */}
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
