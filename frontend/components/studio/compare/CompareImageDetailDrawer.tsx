/**
 * CompareImageDetailDrawer — V4 on-demand prompt 합성 결과 펼침.
 * spec §5.3.7:
 *  - 인라인 spinner ("프롬프트 합성 중...") 진행 모달 X
 *  - 결과 펼침: positive_prompt + summary + key_visual_anchors + uncertain + 복사/재합성 버튼
 *  - 휘발 캐시 (페이지 떠나면 사라짐 · DB 저장 X)
 *  - 전역 직렬화는 부모 (CompareImageDual) 에서 처리 — drawer 는 표시만
 *
 * Props:
 *  - prompt: PerImagePromptResult | null
 *  - loading: boolean
 *  - onCancel: () => void  (재합성 / 결과 초기화 액션)
 *
 * loading=false + prompt=null 이면 미렌더 (방어 가드).
 */

"use client";

import Icon from "@/components/ui/Icon";
import { toast } from "@/stores/useToastStore";
import type { PerImagePromptResult } from "@/stores/useVisionCompareStore";

interface Props {
  prompt: PerImagePromptResult | null;
  loading: boolean;
  onCancel: () => void;
}

export default function CompareImageDetailDrawer({
  prompt,
  loading,
  onCancel,
}: Props) {
  if (!loading && !prompt) return null;

  const onCopy = async () => {
    if (!prompt?.positive_prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.positive_prompt);
      toast.success("프롬프트 복사됨", `${prompt.positive_prompt.length} chars`);
    } catch (err) {
      toast.error("복사 실패", err instanceof Error ? err.message : "");
    }
  };

  return (
    <div
      className="ais-compare-image-drawer"
      style={{
        padding: 12,
        borderRadius: 10,
        background: "var(--bg-2, rgba(148, 163, 184, 0.08))",
        border: "1px solid var(--line-1, rgba(148, 163, 184, 0.2))",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 0",
            color: "var(--ink-2)",
            fontSize: 13,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              border: "2px solid rgba(148, 163, 184, 0.3)",
              borderTopColor: "rgb(124, 58, 237)",
              animation: "spin 0.8s linear infinite",
            }}
          />
          프롬프트 합성 중...
        </div>
      )}
      {!loading && prompt && (
        <>
          {prompt.summary && (
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-1)",
              }}
            >
              {prompt.summary}
            </div>
          )}
          <div
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11.5,
              lineHeight: 1.55,
              color: "var(--ink-2)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {prompt.positive_prompt}
          </div>
          {prompt.key_visual_anchors.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {prompt.key_visual_anchors.map((a, i) => (
                <span
                  key={`anchor-${i}`}
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    background: "rgba(34, 211, 238, 0.12)",
                    color: "rgb(8, 145, 178)",
                  }}
                >
                  {a}
                </span>
              ))}
            </div>
          )}
          {prompt.uncertain.length > 0 && (
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-3, #94a3b8)",
                fontStyle: "italic",
              }}
            >
              uncertain: {prompt.uncertain.join(", ")}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button
              type="button"
              onClick={onCopy}
              aria-label="복사"
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid var(--line-1)",
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
            <button
              type="button"
              onClick={onCancel}
              aria-label="재합성"
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid var(--line-1)",
                background: "transparent",
                fontSize: 11,
                color: "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              재합성
            </button>
          </div>
        </>
      )}
    </div>
  );
}
