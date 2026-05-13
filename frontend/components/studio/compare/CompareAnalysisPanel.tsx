/**
 * CompareAnalysisPanel — /vision/compare 우 패널 V4 결과.
 *
 * 2026-05-05 Block 2 Phase 8 Task 29: 옛 5축 score 매트릭스 폐기 + V4 컴포넌트 7개 통합.
 *  - CompareResultHeader (summary + fidelity chip)
 *  - CompareImageDual (분리 thumbnail + on-demand 버튼)
 *  - CompareSliderViewer (BeforeAfter wipe)
 *  - CompareCommonDiffChips (공통점 cyan / 차이점 amber)
 *  - CompareCategoryMatrix (5 카테고리 × 3-col · mixed 면 skip)
 *  - CompareKeyAnchors (mixed 메인 / 동도메인 보조)
 *  - CompareTransformBox (transform_prompt + 복사)
 *  - CompareUncertainBox (페이지 끝 회색 박스)
 *
 * 외곽: .ais-result-hero-plain (5 페이지 통일 · plain base).
 *  - running: 로딩
 *  - !analysis: 빈 상태
 *  - analysis.fallback: amber 폴백 카드
 *  - 정상: V4 composition
 */

"use client";

import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioLoadingState from "@/components/studio/StudioLoadingState";
import type { VisionCompareAnalysisV4 } from "@/lib/api/types";
import type {
  PerImagePromptResult,
  PerImageWhich,
} from "@/stores/useVisionCompareStore";

import CompareCategoryMatrix from "./CompareCategoryMatrix";
import CompareCommonDiffChips from "./CompareCommonDiffChips";
import CompareImageDual from "./CompareImageDual";
import CompareKeyAnchors from "./CompareKeyAnchors";
import CompareResultHeader from "./CompareResultHeader";
import CompareSliderViewer from "./CompareSliderViewer";
import CompareTransformBox from "./CompareTransformBox";
import CompareUncertainBox from "./CompareUncertainBox";

interface Props {
  running: boolean;
  analysis: VisionCompareAnalysisV4 | null;
  image1Url: string | null;
  image2Url: string | null;
  perImageInFlight: PerImageWhich | null;
  perImagePromptImage1: PerImagePromptResult | null;
  perImagePromptImage2: PerImagePromptResult | null;
  onPerImagePromptRequest: (which: PerImageWhich) => void;
  onPerImagePromptReset: (which: PerImageWhich) => void;
}

export default function CompareAnalysisPanel({
  running,
  analysis,
  image1Url,
  image2Url,
  perImageInFlight,
  perImagePromptImage1,
  perImagePromptImage2,
  onPerImagePromptRequest,
  onPerImagePromptReset,
}: Props) {
  return (
    <div
      className="ais-result-hero-plain"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        minHeight: 262,
      }}
    >
      {running ? (
        <AnalysisLoading />
      ) : !analysis ? (
        <AnalysisEmpty />
      ) : analysis.fallback ? (
        <AnalysisFallback summary={analysis.summaryKo} />
      ) : (
        <AnalysisFilled
          analysis={analysis}
          image1Url={image1Url}
          image2Url={image2Url}
          perImageInFlight={perImageInFlight}
          perImagePromptImage1={perImagePromptImage1}
          perImagePromptImage2={perImagePromptImage2}
          onPerImagePromptRequest={onPerImagePromptRequest}
          onPerImagePromptReset={onPerImagePromptReset}
        />
      )}
    </div>
  );
}

function AnalysisLoading() {
  return (
    <StudioLoadingState
      size="panel"
      title="비교 분석 중…"
      description="2-stage 관찰자 + 차이 합성 진행 중 · 약 30~60초 소요"
    />
  );
}

function AnalysisEmpty() {
  return (
    <StudioEmptyState
      size="panel"
      icon="sparkle"
      title="분석 대기 중"
      description="두 이미지 업로드 후 좌측의 비교 분석 시작 을 눌러 주세요"
    />
  );
}

function AnalysisFallback({ summary }: { summary: string }) {
  return (
    <div className="ais-cac-fallback">
      <div className="ais-cac-fallback-title">분석 부분 실패</div>
      {summary || "비전 모델 응답을 파싱하지 못했습니다."}
    </div>
  );
}

function AnalysisFilled({
  analysis,
  image1Url,
  image2Url,
  perImageInFlight,
  perImagePromptImage1,
  perImagePromptImage2,
  onPerImagePromptRequest,
  onPerImagePromptReset,
}: {
  analysis: VisionCompareAnalysisV4;
  image1Url: string | null;
  image2Url: string | null;
  perImageInFlight: PerImageWhich | null;
  perImagePromptImage1: PerImagePromptResult | null;
  perImagePromptImage2: PerImagePromptResult | null;
  onPerImagePromptRequest: (which: PerImageWhich) => void;
  onPerImagePromptReset: (which: PerImageWhich) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 1. 결과 헤더 (summary + fidelity chip) */}
      <CompareResultHeader
        summaryEn={analysis.summaryEn}
        summaryKo={analysis.summaryKo}
        fidelityScore={analysis.fidelityScore}
        domainMatch={analysis.domainMatch}
      />

      {/* 2. 이미지 영역 — 분리 thumbnail + 슬라이더 동시 (이미지 둘 다 있을 때만) */}
      {image1Url && image2Url && (
        <>
          <CompareImageDual
            image1Url={image1Url}
            image2Url={image2Url}
            image1Prompt={perImagePromptImage1}
            image2Prompt={perImagePromptImage2}
            inFlight={perImageInFlight}
            onPromptRequest={onPerImagePromptRequest}
            onPromptReset={onPerImagePromptReset}
          />
          <CompareSliderViewer image1Url={image1Url} image2Url={image2Url} />
        </>
      )}

      {/* 3. 공통점 / 차이점 칩 */}
      <CompareCommonDiffChips
        commonPointsKo={analysis.commonPointsKo}
        commonPointsEn={analysis.commonPointsEn}
        keyDifferencesKo={analysis.keyDifferencesKo}
        keyDifferencesEn={analysis.keyDifferencesEn}
      />

      {/* 4. 5 카테고리 매트릭스 — mixed 면 skip */}
      {analysis.domainMatch !== "mixed" && (
        <CompareCategoryMatrix categoryDiffs={analysis.categoryDiffs} />
      )}

      {/* 5. Key Anchors — mixed 메인 / 동도메인 보조 */}
      <CompareKeyAnchors
        anchors={analysis.keyAnchors}
        domainMatch={analysis.domainMatch}
      />

      {/* 6. transform_prompt 박스 */}
      <CompareTransformBox
        transformPromptEn={analysis.transformPromptEn}
        transformPromptKo={analysis.transformPromptKo}
      />

      {/* 7. uncertain 박스 (페이지 끝) */}
      <CompareUncertainBox
        uncertainEn={analysis.uncertainEn}
        uncertainKo={analysis.uncertainKo}
      />
    </div>
  );
}
