/**
 * CompareTransformBox — V4 transform_prompt 박스.
 * spec §5.3.6: 영문 prompt + 복사 버튼 + "한국어 ▾" 토글.
 *
 * 본문은 영문 우선 (t2i 입력용). 한국어는 토글 펼침.
 * 복사 버튼은 영문 텍스트 클립보드 복사 + 토스트.
 */

"use client";

import { useState } from "react";

import Icon from "@/components/ui/Icon";
import { toast } from "@/stores/useToastStore";

interface Props {
  transformPromptEn: string;
  transformPromptKo: string;
}

export default function CompareTransformBox({
  transformPromptEn,
  transformPromptKo,
}: Props) {
  const [showKo, setShowKo] = useState(false);
  const en = transformPromptEn.trim();
  const ko = transformPromptKo.trim();

  if (!en && !ko) return null;

  const onCopy = async () => {
    if (!en && !ko) return;
    const text = en || ko;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("변형 프롬프트 복사됨", `${text.length} chars`);
    } catch (err) {
      toast.error("복사 실패", err instanceof Error ? err.message : "");
    }
  };

  return (
    <div
      className="ais-compare-transform"
      style={{
        padding: 14,
        borderRadius: 10,
        background: "rgba(139, 92, 246, 0.06)",
        border: "1px solid rgba(139, 92, 246, 0.2)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: "rgb(124, 58, 237)",
          }}
        >
          TRANSFORM · A → B 변형 가이드
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {ko && (
            <button
              type="button"
              onClick={() => setShowKo((v) => !v)}
              aria-label={showKo ? "한국어 접기" : "한국어 펼치기"}
              aria-expanded={showKo}
              style={{
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid rgba(139, 92, 246, 0.3)",
                background: "transparent",
                fontSize: 11,
                color: "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              {showKo ? "▴ 한국어" : "▾ 한국어"}
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            aria-label="복사"
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: "1px solid rgba(139, 92, 246, 0.3)",
              background: "transparent",
              fontSize: 11,
              color: "var(--ink-2)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="copy" size={11} />
            복사
          </button>
        </div>
      </div>
      <div
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--ink-1)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {en || ko}
      </div>
      {showKo && ko && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.55,
            color: "var(--ink-2)",
            paddingTop: 8,
            borderTop: "1px dashed rgba(139, 92, 246, 0.2)",
          }}
        >
          {ko}
        </div>
      )}
      <div
        style={{
          fontSize: 10,
          color: "var(--ink-3, #94a3b8)",
          fontStyle: "italic",
        }}
      >
        이 명령어를 generate / edit 페이지에 붙여넣어 image1 을 image2 처럼 변환하세요
      </div>
    </div>
  );
}
