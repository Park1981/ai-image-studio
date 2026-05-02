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
 *
 * 2026-05-02 디자인 V5 Phase 7 격상:
 *  - inline → className `.ais-transform-prompt-box` (V5 violet gradient bg + violet border)
 *  - inline → className `.ais-uncertain-box` (V5 amber gradient bg + amber border)
 *  - eyebrow `.ais-cac-eyebrow` (CSS 가 자동 색 분기 — violet / amber-ink)
 *  - body className `.ais-tp-body` (mono 11.5)
 *  - 헤더 행 (eyebrow + contextLabel + 복사 버튼) → `.ais-tp-header`
 *  - 복사 버튼 → `.ais-vs-copy-btn` (Phase 6 공용 className 재사용)
 */

"use client";

import Icon from "@/components/ui/Icon";
import { toast } from "@/stores/useToastStore";

/**
 * Transform Prompt 박스 — V5 violet gradient 시그니처.
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
    <div className="ais-transform-prompt-box">
      <div className="ais-tp-header">
        <span className="ais-cac-eyebrow">
          TRANSFORM
          <span className="ais-tp-context-meta">· {contextLabel}</span>
        </span>
        <button type="button" className="ais-vs-copy-btn" onClick={onCopy}>
          <Icon name="copy" size={11} />
          복사
        </button>
      </div>
      <div className="ais-tp-body">
        {text}
        {showEn && textEn && <div className="ais-tp-en-sub">{textEn}</div>}
      </div>
    </div>
  );
}

/** Uncertain 박스 — V5 amber gradient 시그니처. */
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
    <div className="ais-uncertain-box">
      <div className="ais-cac-eyebrow">
        <Icon name="search" size={11} />
        UNCERTAIN · 비교 못한 영역
      </div>
      {/* body — 부모 .ais-uncertain-box cascade (font-size 12.5 / ink-2 / line-height 1.55) 가 처리 */}
      <div>{text}</div>
    </div>
  );
}
