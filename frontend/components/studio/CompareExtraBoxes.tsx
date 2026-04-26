/**
 * CompareExtraBoxes - Vision Compare + Edit 비교 분석 공용 박스 (spec 19 후속).
 *
 * 원래 vision/compare/page.tsx 안에 로컬 컴포넌트로 있었던 두 박스를 공용으로 분리.
 * Edit 모달 (ComparisonAnalysisModal) + Vision Compare 페이지 둘 다 사용.
 *
 * 의미는 context 별로 다름 (백엔드 spec 19 동일 정책):
 *   - Vision Compare: TransformPromptBox = "A 를 B 로 바꾸는 t2i 변형 지시"
 *   - Edit context : TransformPromptBox = "사용자 의도를 완벽 실현하려면 추가로 필요한 변경"
 *   - 둘 다 UncertainBox = "비전이 신뢰성 있게 비교 못한 영역"
 */

"use client";

import Icon from "@/components/ui/Icon";
import { toast } from "@/stores/useToastStore";

/**
 * Transform Prompt 박스 — 보라색 left-bar.
 *
 * @param contextLabel 헤더 라벨 (예: "A → B 변형 가이드" / "추가 수정 가이드")
 */
export function TransformPromptBox({
  textKo,
  textEn,
  contextLabel = "A → B 변형 가이드",
}: {
  textKo?: string;
  textEn?: string;
  contextLabel?: string;
}) {
  const text = (textKo && textKo.trim()) || (textEn && textEn.trim()) || "";
  const showEn = !!(textEn && textEn !== textKo);
  const onCopy = async () => {
    if (!text) {
      toast.warn("복사할 내용이 없습니다.");
      return;
    }
    try {
      // 복붙은 영문 우선 (t2i 입력용) — 영문 없으면 한국어
      const copyText = (textEn && textEn.trim()) || text;
      await navigator.clipboard.writeText(copyText);
      toast.success("변형 프롬프트 복사됨", `${copyText.length} chars`);
    } catch (err) {
      toast.error("복사 실패", err instanceof Error ? err.message : "");
    }
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderLeft: "3px solid #A855F7",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--line)",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#A855F7",
          }}
        >
          <Icon name="sparkle" size={11} />
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#A855F7",
              letterSpacing: ".1em",
            }}
          >
            TRANSFORM PROMPT
          </span>
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
              fontWeight: 500,
            }}
          >
            · {contextLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 10,
            color: "var(--ink-3)",
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--line)",
            background: "var(--bg-2)",
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <Icon name="copy" size={10} /> 복사
        </button>
      </div>
      <div
        style={{
          padding: "10px 12px",
          fontSize: 12,
          lineHeight: 1.55,
          color: "var(--ink-2)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
        {showEn && textEn && (
          <div
            className="mono"
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px dashed var(--line)",
              fontSize: 10.5,
              color: "var(--ink-4)",
              lineHeight: 1.5,
            }}
          >
            {textEn}
          </div>
        )}
      </div>
    </div>
  );
}

/** Uncertain 박스 — 회색 톤. */
export function UncertainBox({
  textKo,
  textEn,
}: {
  textKo?: string;
  textEn?: string;
}) {
  const text = (textKo && textKo.trim()) || (textEn && textEn.trim()) || "";
  if (!text) return null;
  return (
    <div
      style={{
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        padding: "8px 12px",
        fontSize: 11.5,
        color: "var(--ink-3)",
        lineHeight: 1.5,
        opacity: 0.9,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 3,
          color: "var(--ink-4)",
        }}
      >
        <Icon name="search" size={10} />
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: ".1em",
            textTransform: "uppercase",
          }}
        >
          Uncertain · 비교 못한 영역
        </span>
      </div>
      {text}
    </div>
  );
}
