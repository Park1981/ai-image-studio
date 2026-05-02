/**
 * vision-result/PromptToggle — VisionResultCard 의 PROMPT 영역 (통합/분리 토글).
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 *
 * 통합 모드: A1111 표준 (positive + Negative prompt: negative)
 * 분리 모드: hairline 으로 구분된 두 섹션 (각자 헤더 + 복사 버튼)
 *
 * 2026-05-02 디자인 V5 Phase 6 격상 (회귀 위험 #10 보존):
 *  - combined/split toggle **보존 필수**
 *  - A1111 호환 `combinedText` (positive + Negative prompt: negative) **보존 필수**
 *  - 통합 모드 복사 버튼 (`onCopy(combinedText, "통합 프롬프트")`) **보존 필수**
 *  - 카드 외곽 className `.ais-vision-prompt-toggle` + 헤더 `.ais-vpt-header` + body `.ais-vpt-body`
 *  - mode tabs className `.ais-vs-actions` + `.ais-vpt-mode-tabs` + `.ais-vpt-mode-btn` data-active
 *  - 분리 모드 sectionColor 톤만 변경: var(--accent) → #2D7A2D (POSITIVE green) / "#EF4444" → "#B8232C" (NEGATIVE red)
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { toast } from "@/stores/useToastStore";

type PromptMode = "combined" | "split";

interface Props {
  positive: string;
  negative: string;
}

// V5 Phase 6 — split 모드 섹션 색 톤 (plan §6 명시)
const POSITIVE_COLOR = "#2D7A2D"; // green
const NEGATIVE_COLOR = "#B8232C"; // red

export default function PromptToggleCard({ positive, negative }: Props) {
  const [mode, setMode] = useState<PromptMode>("combined");

  // A1111 표준: positive 줄 + 빈 줄 + "Negative prompt: " 줄 (회귀 #10 보존 필수)
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
    <div className="ais-vision-prompt-toggle">
      {/* 카드 메인 헤더 — 모드 따라 메타 라벨 / chars / 복사 분기 */}
      <div className="ais-vpt-header">
        <span className="ais-vs-eyebrow">
          <Icon name="sparkle" size={13} />
          PROMPT
          <span className="ais-vpt-meta">
            {mode === "combined" ? "· A1111 호환" : "· 분리 보기"}
          </span>
        </span>
        <div className="ais-vs-actions">
          <PromptModeToggle mode={mode} onChange={setMode} />
          {mode === "combined" && (
            <>
              <span className="ais-vpt-chars">{combinedText.length} chars</span>
              <button
                type="button"
                className="ais-vs-copy-btn"
                onClick={() => onCopy(combinedText, "통합 프롬프트")}
              >
                <Icon name="copy" size={11} />
                복사
              </button>
            </>
          )}
        </div>
      </div>

      {mode === "combined" ? (
        /* 통합 본문 (한 영역) — 회귀 #10 보존: positive + Negative prompt: negative */
        <div className="ais-vpt-body">
          {positive ? (
            <>
              {positive}
              {negative && (
                <>
                  {"\n\n"}
                  <span className="ais-vpt-negative-label">
                    Negative prompt:
                  </span>{" "}
                  <span className="ais-vpt-negative-text">{negative}</span>
                </>
              )}
            </>
          ) : (
            <span className="ais-vpt-empty">결과 없음</span>
          )}
        </div>
      ) : (
        /* 분리 본문 (두 섹션) — V5 색 톤 (POSITIVE green / NEGATIVE red) */
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

/** 분리 모드의 단일 섹션 (POSITIVE 또는 NEGATIVE) — V5 색 톤 (green / red) */
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
  const iconName = isPositive ? "sparkle" : "x";

  return (
    <div
      className="ais-vpt-section"
      data-kind={kind}
      data-show-top-border={showTopBorder ? "true" : "false"}
    >
      {/* 섹션 헤더 */}
      <div className="ais-vpt-section-header">
        <span className="ais-vpt-section-title">
          <Icon name={iconName} size={12} />
          {sectionTitle}
          <span className="ais-vpt-section-meta">· {sectionMeta}</span>
        </span>
        <div className="ais-vs-actions">
          <span className="ais-vpt-chars">{text.length} chars</span>
          <button type="button" className="ais-vs-copy-btn" onClick={onCopy}>
            <Icon name="copy" size={11} />
            복사
          </button>
        </div>
      </div>
      {/* 섹션 본문 */}
      <div className="ais-vpt-section-body" data-kind={kind}>
        {text || <span className="ais-vpt-empty">결과 없음</span>}
      </div>
    </div>
  );
}

/** 통합/분리 segment toggle — V5 className 적용 */
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
      className="ais-vpt-mode-tabs"
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
            data-active={active ? "true" : "false"}
            className="ais-vpt-mode-btn"
            onClick={() => onChange(opt.key)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// V5 색 톤 export (플랜 §6 명시 · 다른 곳 사용 가능)
export { POSITIVE_COLOR, NEGATIVE_COLOR };

// SmallBtn 미사용 (V5 className 으로 전환됨) — import 제거
