/**
 * VisionResultCard — Vision Recipe v2 결과 표시 (2026-04-26 spec 18 통합).
 *
 * 두 모드 자동 분기 (positivePrompt 유무로 판정):
 *   - v2 row: summary + PROMPT + NEGATIVE + 디테일 6 슬롯
 *   - 옛 v1 row (positivePrompt 빈): 영/한 탭 + 단락 (legacy 카드)
 *
 * 3 상태:
 *   - loading (running=true)
 *   - empty (result=null)
 *   - filled (v2 또는 v1)
 *
 * 모든 영역에 복사 버튼 (PROMPT / NEGATIVE / summary) — 호출처 어디서든 복사 후 다른 곳 사용.
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { SmallBtn } from "@/components/ui/primitives";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioLoadingState from "@/components/studio/StudioLoadingState";
import { toast } from "@/stores/useToastStore";

/** v2 9 슬롯 + 옛 호환 en/ko. positivePrompt 비면 옛 row. */
export interface VisionCardResult {
  en: string;
  ko: string | null;
  summary?: string;
  positivePrompt?: string;
  negativePrompt?: string;
  composition?: string;
  subject?: string;
  clothingOrMaterials?: string;
  environment?: string;
  lightingCameraStyle?: string;
  uncertain?: string;
}

interface Props {
  result: VisionCardResult | null;
  running: boolean;
}

export default function VisionResultCard({ result, running }: Props) {
  // ─── Loading ───
  if (running) {
    return (
      <StudioLoadingState
        title="분석 중…"
        description="Vision Recipe v2 추출 + 한글 번역"
      />
    );
  }

  // ─── Empty ───
  if (!result) {
    return (
      <StudioEmptyState size="normal">
        이미지를 업로드하고 <b>분석</b> 버튼을 눌러 주세요.
      </StudioEmptyState>
    );
  }

  // ─── Branching: v2 vs v1 ───
  const isV2 = !!(result.positivePrompt && result.positivePrompt.trim());
  if (isV2) return <RecipeV2View result={result} />;
  return <LegacyV1View result={result} />;
}

/* ─────────────────────────────────────────
   Vision Recipe v2 — 풀 9 슬롯 카드
   ───────────────────────────────────────── */
function RecipeV2View({ result }: { result: VisionCardResult }) {
  const summary = result.summary || "";
  const positive = result.positivePrompt || "";
  const negative = result.negativePrompt || "";
  const ko = result.ko || "";
  const koFailed = result.ko === null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* ── Summary 카드 (한국어 우선 + 영문 토글) ── */}
      {summary && (
        <SummaryCard
          en={summary}
          ko={ko}
          koFailed={koFailed}
        />
      )}

      {/* ── PROMPT 토글 카드 (통합/분리 전환) ── */}
      <PromptToggleCard positive={positive} negative={negative} />

      {/* ── 디테일 슬롯 그리드 (6개) ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
        }}
      >
        <DetailCard label="구도" value={result.composition} icon="grid" />
        <DetailCard label="피사체" value={result.subject} icon="scan-eye" />
        <DetailCard
          label="의상 · 재질"
          value={result.clothingOrMaterials}
          icon="image"
        />
        <DetailCard label="환경" value={result.environment} icon="film" />
        <DetailCard
          label="조명 · 카메라"
          value={result.lightingCameraStyle}
          icon="zoom-in"
        />
        <DetailCard
          label="불확실"
          value={result.uncertain}
          icon="search"
          muted
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   PromptToggleCard — 통합/분리 모드 한 카드 안에서 분기.
   2026-04-26 v2 (사용자 피드백 반영):
     - 분리 모드 토글 헤더가 카드 밖 떠 있던 문제 해결 → 한 카드 안에 헤더 통합
     - 통합 ↔ 분리 전환 시 카드 윤곽 동일 (시각 위계 흔들리지 않음)
     - 분리 모드: positive / negative 두 영역을 hairline 으로만 구분 (각자 자체 헤더 + 복사)
   ───────────────────────────────────────── */
function PromptToggleCard({
  positive,
  negative,
}: {
  positive: string;
  negative: string;
}) {
  const [mode, setMode] = useState<"combined" | "split">("combined");

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
  mode: "combined" | "split";
  onChange: (m: "combined" | "split") => void;
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

/* ─────────────────────────────────────────
   Summary 카드 — 한/영 토글
   ───────────────────────────────────────── */
function SummaryCard({
  en,
  ko,
  koFailed,
}: {
  en: string;
  ko: string;
  koFailed: boolean;
}) {
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
        <div
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
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

/* ─────────────────────────────────────────
   DetailCard — 디테일 슬롯 (6개 · 그리드 카드)
   ───────────────────────────────────────── */
function DetailCard({
  label,
  value,
  icon,
  muted = false,
}: {
  label: string;
  value: string | undefined;
  icon: "grid" | "scan-eye" | "image" | "film" | "zoom-in" | "search";
  muted?: boolean;
}) {
  const empty = !value || !value.trim();
  return (
    <div
      style={{
        background: muted ? "var(--bg-2)" : "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        opacity: muted && !empty ? 0.85 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: muted ? "var(--ink-4)" : "var(--ink-3)",
        }}
      >
        <Icon name={icon} size={11} />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: muted ? "var(--ink-4)" : "var(--ink-3)",
            letterSpacing: ".04em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: muted ? "var(--ink-3)" : "var(--ink)",
          wordBreak: "break-word",
        }}
      >
        {empty ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              fontStyle: "italic",
            }}
          >
            (없음)
          </span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   LegacyV1View — 옛 row (positivePrompt 빈) 폴백 카드
   기존 영/한 탭 + 단락 디자인 그대로 보존.
   ───────────────────────────────────────── */
function LegacyV1View({ result }: { result: VisionCardResult }) {
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
