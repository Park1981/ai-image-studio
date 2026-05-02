/**
 * vision-result/SummaryCard — 한/영 토글이 가능한 Summary 카드.
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 *
 * 2026-05-02 디자인 V5 Phase 6 격상:
 *  - inline → className `.ais-vision-summary` + 자식 `.ais-vs-*`
 *  - data-lang 분기 — 한글 = Pretendard / 영문 = Fraunces italic 13.5 (CSS 가 fontFamily 자동)
 *  - 한/영 tab + 복사 버튼 그대로 (회귀 0)
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
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
    <div className="ais-vision-summary">
      <div className="ais-vs-header">
        <span className="ais-vs-eyebrow">
          <Icon name="sparkle" size={13} />
          요약
        </span>
        <div className="ais-vs-actions">
          <div role="tablist" className="ais-vs-lang-tabs" aria-label="요약 언어">
            {(["ko", "en"] as const).map((l) => {
              const active = lang === l;
              const disabled = l === "ko" && koDisabled;
              return (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  className="ais-vs-lang-btn"
                  aria-selected={active}
                  disabled={disabled}
                  data-active={active ? "true" : "false"}
                  data-disabled={disabled ? "true" : "false"}
                  onClick={() => !disabled && setLang(l)}
                  title={disabled ? "한글 번역 실패" : ""}
                >
                  {l === "ko" ? "한글" : "영문"}
                </button>
              );
            })}
          </div>
          <button type="button" className="ais-vs-copy-btn" onClick={onCopy}>
            <Icon name="copy" size={11} />
            복사
          </button>
        </div>
      </div>
      <div className="ais-vs-body" data-lang={lang}>
        {text || (
          <span className="ais-vs-empty">
            {koDisabled && lang === "ko"
              ? "한글 번역 실패 — 영문 탭에서 확인."
              : "결과 없음"}
          </span>
        )}
      </div>
    </div>
  );
}
