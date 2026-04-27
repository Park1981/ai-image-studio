/**
 * vision-result/PromptToggle — VisionResultCard 의 PROMPT 영역 (통합/분리 토글).
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 *
 * 통합 모드: A1111 표준 (positive + Negative prompt: negative)
 * 분리 모드: hairline 으로 구분된 두 섹션 (각자 헤더 + 복사 버튼)
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { SmallBtn } from "@/components/ui/primitives";
import { toast } from "@/stores/useToastStore";

type PromptMode = "combined" | "split";

interface Props {
  positive: string;
  negative: string;
}

export default function PromptToggleCard({ positive, negative }: Props) {
  const [mode, setMode] = useState<PromptMode>("combined");

  // A1111 표준: positive 줄 + 빈 줄 + "Negative prompt: " 줄
  const combinedText =
    negative.trim() && positive.trim()
      ? `${positive}\n\nNegative prompt: ${negative}`
      : positive || negative;

  const onCopy = async (text: string, label: string) => {
    if (!text.trim()) {
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

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderLeft: "3px solid var(--accent)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
      }}
    >
      {/* ── 카드 메인 헤더 — 모드 따라 메타 라벨 / chars / 복사 분기 ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--line)",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--accent)",
            minWidth: 0,
          }}
        >
          <Icon name="sparkle" size={13} />
          <span
            className="mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--accent)",
              letterSpacing: ".08em",
            }}
          >
            PROMPT
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {mode === "combined" ? "· A1111 호환" : "· 분리 보기"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <PromptModeToggle mode={mode} onChange={setMode} />
          {mode === "combined" && (
            <>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: "var(--ink-4)" }}
              >
                {combinedText.length} chars
              </span>
              <SmallBtn
                icon="copy"
                onClick={() => onCopy(combinedText, "통합 프롬프트")}
              >
                복사
              </SmallBtn>
            </>
          )}
        </div>
      </div>

      {mode === "combined" ? (
        /* ── 통합 본문 (한 영역) ── */
        <div
          style={{
            padding: "14px 16px",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--ink)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            minHeight: 80,
          }}
        >
          {positive ? (
            <>
              {positive}
              {negative && (
                <>
                  {"\n\n"}
                  <span
                    style={{
                      color: "#EF4444",
                      fontWeight: 600,
                    }}
                  >
                    Negative prompt:
                  </span>{" "}
                  <span style={{ color: "var(--ink-3)" }}>{negative}</span>
                </>
              )}
            </>
          ) : (
            <span
              style={{
                color: "var(--ink-4)",
                fontStyle: "italic",
                fontSize: 12,
              }}
            >
              결과 없음
            </span>
          )}
        </div>
      ) : (
        /* ── 분리 본문 (두 섹션 · hairline 으로 구분) ── */
        <>
          <PromptSection
            kind="positive"
            text={positive}
            onCopy={() => onCopy(positive, "긍정 프롬프트")}
          />
          {negative && (
            <PromptSection
              kind="negative"
              text={negative}
              onCopy={() => onCopy(negative, "부정 프롬프트")}
              showTopBorder
            />
          )}
        </>
      )}
    </div>
  );
}

/** 분리 모드의 단일 섹션 (POSITIVE 또는 NEGATIVE) */
function PromptSection({
  kind,
  text,
  onCopy,
  showTopBorder = false,
}: {
  kind: "positive" | "negative";
  text: string;
  onCopy: () => void;
  showTopBorder?: boolean;
}) {
  const isPositive = kind === "positive";
  const sectionTitle = isPositive ? "POSITIVE" : "NEGATIVE";
  const sectionMeta = isPositive ? "t2i 재생성 입력" : "회피 리스트";
  const sectionColor = isPositive ? "var(--accent)" : "#EF4444";
  const iconName = isPositive ? "sparkle" : "x";

  return (
    <div
      style={{
        borderTop: showTopBorder ? "1px solid var(--line)" : undefined,
      }}
    >
      {/* 섹션 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px 6px",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            color: sectionColor,
            minWidth: 0,
          }}
        >
          <Icon name={iconName} size={12} />
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              color: sectionColor,
              letterSpacing: ".08em",
            }}
          >
            {sectionTitle}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            · {sectionMeta}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 10.5, color: "var(--ink-4)" }}
          >
            {text.length} chars
          </span>
          <SmallBtn icon="copy" onClick={onCopy}>
            복사
          </SmallBtn>
        </div>
      </div>
      {/* 섹션 본문 */}
      <div
        style={{
          padding: "0 16px 14px",
          fontSize: isPositive ? 13 : 12,
          lineHeight: 1.6,
          color: "var(--ink)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: isPositive ? "inherit" : "var(--font-mono, monospace)",
          minHeight: isPositive ? 60 : 30,
        }}
      >
        {text || (
          <span
            style={{
              color: "var(--ink-4)",
              fontStyle: "italic",
              fontSize: 11.5,
            }}
          >
            결과 없음
          </span>
        )}
      </div>
    </div>
  );
}

/** 통합/분리 segment toggle */
function PromptModeToggle({
  mode,
  onChange,
}: {
  mode: PromptMode;
  onChange: (m: PromptMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="프롬프트 표시 모드"
      style={{
        display: "inline-flex",
        background: "var(--bg-2)",
        borderRadius: "var(--radius-sm)",
        padding: 2,
        gap: 2,
      }}
    >
      {(
        [
          { key: "combined", label: "통합" },
          { key: "split", label: "분리" },
        ] as const
      ).map((opt) => {
        const active = mode === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              color: active ? "var(--ink)" : "var(--ink-3)",
              background: active ? "var(--surface)" : "transparent",
              boxShadow: active ? "var(--shadow-sm)" : "none",
              letterSpacing: 0,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
