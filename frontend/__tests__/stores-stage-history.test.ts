/**
 * stores-stage-history.test.ts — Phase 6 (2026-04-27) 진행 모달 통일 산출물 검증.
 *
 * 검증 범위:
 *   - useVisionStore / useVisionCompareStore 의 stageHistory 상태 + pushStage + resetStages
 *   - 초기 상태 sane (stageHistory: [])
 *   - pushStage 누적 + 순서 보존
 *   - resetStages 가 stageHistory 만 비우고 다른 필드 영향 X (휘발 정책 검증)
 *
 * 필요한 store action 누락 시 즉시 실패 — Phase 6 의 핵심 SSE drain 패턴이
 * 깨졌는지 회귀 검증 (PipelineTimeline 이 stageHistory 를 못 받으면 모달 표시 망함).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useVisionStore } from "@/stores/useVisionStore";
import { useVisionCompareStore } from "@/stores/useVisionCompareStore";

// 테스트 간 store 격리 — Phase 6 신규 stageHistory + 기존 필드 모두 초기화
function resetVisionStore() {
  useVisionStore.setState({
    currentImage: null,
    currentLabel: "이미지를 업로드하면 Vision 분석 시작",
    currentWidth: null,
    currentHeight: null,
    running: false,
    lastResult: null,
    stageHistory: [],
    entries: [],
  });
}

function resetVisionCompareStore() {
  useVisionCompareStore.setState({
    imageA: null,
    imageB: null,
    hint: "",
    running: false,
    analysis: null,
    viewerMode: "slider",
    stageHistory: [],
  });
}

describe("useVisionStore — stageHistory (Phase 6)", () => {
  beforeEach(resetVisionStore);

  it("초기 stageHistory 는 빈 배열", () => {
    expect(useVisionStore.getState().stageHistory).toEqual([]);
  });

  it("pushStage 가 stage 이벤트 누적 + 순서 보존", () => {
    const { pushStage } = useVisionStore.getState();
    pushStage({
      type: "vision-encoding",
      label: "이미지 인코딩",
      progress: 5,
      arrivedAt: 1000,
    });
    pushStage({
      type: "vision-analyze",
      label: "이미지 분석",
      progress: 20,
      arrivedAt: 1100,
    });
    pushStage({
      type: "translation",
      label: "한국어 번역",
      progress: 70,
      arrivedAt: 1200,
    });

    const { stageHistory } = useVisionStore.getState();
    expect(stageHistory).toHaveLength(3);
    expect(stageHistory.map((s) => s.type)).toEqual([
      "vision-encoding",
      "vision-analyze",
      "translation",
    ]);
    // arrivedAt 순서 보존 — PipelineTimeline 의 elapsed 계산 정확성 보장
    expect(stageHistory.map((s) => s.arrivedAt)).toEqual([1000, 1100, 1200]);
  });

  it("pushStage payload 는 그대로 보존 (백엔드 detail 흡수)", () => {
    const { pushStage } = useVisionStore.getState();
    pushStage({
      type: "vision-analyze",
      label: "이미지 분석 완료",
      progress: 65,
      arrivedAt: 2000,
      payload: {
        summary: "An editorial portrait...",
        provider: "ollama",
        fallback: false,
      },
    });

    const { stageHistory } = useVisionStore.getState();
    // payload 그대로 보존 — StageDef.renderDetail 콜백이 사용
    expect(stageHistory[0].payload).toEqual({
      summary: "An editorial portrait...",
      provider: "ollama",
      fallback: false,
    });
  });

  it("resetStages 가 stageHistory 만 비우고 entries 등 영속 필드 영향 X", () => {
    // 사전: stageHistory 채움 + entries 채움
    const { pushStage, addEntry } = useVisionStore.getState();
    pushStage({
      type: "vision-analyze",
      label: "이미지 분석",
      progress: 20,
      arrivedAt: 1000,
    });
    addEntry({
      id: "vis-test-001",
      imageRef: "data:image/png;base64,xxxx",
      thumbLabel: "test.png · 1024×768",
      en: "test",
      ko: "테스트",
      createdAt: Date.now(),
      visionModel: "qwen2.5vl:7b",
      width: 1024,
      height: 768,
    });

    expect(useVisionStore.getState().stageHistory).toHaveLength(1);
    expect(useVisionStore.getState().entries).toHaveLength(1);

    // resetStages 실행
    useVisionStore.getState().resetStages();

    // stageHistory 만 빈 배열 / entries 는 그대로
    expect(useVisionStore.getState().stageHistory).toEqual([]);
    expect(useVisionStore.getState().entries).toHaveLength(1);
  });

  it("새 분석 시작 시 resetStages → pushStage 패턴 (useVisionPipeline 의 동작)", () => {
    const { pushStage, resetStages } = useVisionStore.getState();
    // 이전 분석의 stage 가 남아있는 상태
    pushStage({
      type: "vision-analyze",
      label: "이미지 분석",
      progress: 20,
      arrivedAt: 500,
    });
    pushStage({
      type: "translation",
      label: "한국어 번역",
      progress: 70,
      arrivedAt: 600,
    });
    expect(useVisionStore.getState().stageHistory).toHaveLength(2);

    // 새 분석 시작 — resetStages
    resetStages();
    expect(useVisionStore.getState().stageHistory).toEqual([]);

    // 새 stage 도착
    pushStage({
      type: "vision-encoding",
      label: "이미지 인코딩",
      progress: 5,
      arrivedAt: 1000,
    });
    expect(useVisionStore.getState().stageHistory).toHaveLength(1);
    expect(useVisionStore.getState().stageHistory[0].type).toBe(
      "vision-encoding",
    );
  });
});

describe("useVisionCompareStore — stageHistory (Phase 6)", () => {
  beforeEach(resetVisionCompareStore);

  it("초기 stageHistory 는 빈 배열", () => {
    expect(useVisionCompareStore.getState().stageHistory).toEqual([]);
  });

  it("pushStage 가 stage 이벤트 누적 + 순서 보존", () => {
    const { pushStage } = useVisionCompareStore.getState();
    pushStage({
      type: "compare-encoding",
      label: "이미지 A/B 인코딩",
      progress: 5,
      arrivedAt: 1000,
    });
    pushStage({
      type: "observe1",
      label: "Image1 관찰",
      progress: 20,
      arrivedAt: 1100,
    });

    const { stageHistory } = useVisionCompareStore.getState();
    expect(stageHistory.map((s) => s.type)).toEqual([
      "compare-encoding",
      "observe1",
    ]);
  });

  it("Vision Compare V4 — 5 stage 시퀀스 누적 (compare-encoding/observe1/observe2/diff-synth/translation)", () => {
    const { pushStage } = useVisionCompareStore.getState();
    const v4Sequence = [
      { type: "compare-encoding", label: "이미지 A/B 인코딩", progress: 5,  arrivedAt: 1000 },
      { type: "observe1",         label: "Image1 관찰",      progress: 20, arrivedAt: 1100 },
      { type: "observe2",         label: "Image2 관찰",      progress: 40, arrivedAt: 1200 },
      { type: "diff-synth",       label: "차이 합성",        progress: 70, arrivedAt: 1300 },
      { type: "translation",      label: "한국어 번역",      progress: 90, arrivedAt: 1400 },
    ];
    for (const s of v4Sequence) {
      pushStage(s);
    }

    const { stageHistory } = useVisionCompareStore.getState();
    expect(stageHistory).toHaveLength(5);
    // V4 는 옛 vision-pair / intent-refine 시퀀스 폐기
    expect(stageHistory.map((s) => s.type)).not.toContain("vision-pair");
    expect(stageHistory.map((s) => s.type)).not.toContain("intent-refine");
    expect(stageHistory.map((s) => s.type)).toEqual([
      "compare-encoding",
      "observe1",
      "observe2",
      "diff-synth",
      "translation",
    ]);
  });

  it("resetStages 가 다른 필드 영향 X (analysis / hint 등 보존)", () => {
    // 사전: stageHistory + analysis + hint 모두 설정
    const { pushStage, setHint, setAnalysis } =
      useVisionCompareStore.getState();
    pushStage({
      type: "compare-encoding",
      label: "이미지 A/B 인코딩",
      progress: 5,
      arrivedAt: 1000,
    });
    setHint("색감만 비교해줘");
    setAnalysis({
      // V4 minimal fixture — analysis 필드 보존 verify 용 (내용 무관).
      summaryEn: "ok",
      summaryKo: "좋음",
      commonPointsEn: [],
      commonPointsKo: [],
      keyDifferencesEn: [],
      keyDifferencesKo: [],
      domainMatch: "person",
      categoryDiffs: {},
      categoryScores: {},
      keyAnchors: [],
      fidelityScore: null,
      transformPromptEn: "",
      transformPromptKo: "",
      uncertainEn: "",
      uncertainKo: "",
      observation1: {},
      observation2: {},
      provider: "ollama",
      fallback: false,
      analyzedAt: 1000,
      visionModel: "qwen3-vl:8b",
      textModel: "gemma4-un:latest",
    });

    useVisionCompareStore.getState().resetStages();

    expect(useVisionCompareStore.getState().stageHistory).toEqual([]);
    expect(useVisionCompareStore.getState().hint).toBe("색감만 비교해줘");
    expect(useVisionCompareStore.getState().analysis).not.toBeNull();
  });

  it("reset() 은 stageHistory 도 함께 초기화 (페이지 떠날 때)", () => {
    const { pushStage, setHint, setAnalysis } =
      useVisionCompareStore.getState();
    pushStage({
      type: "vision-pair",
      label: "이미지 비교 분석",
      progress: 25,
      arrivedAt: 1000,
    });
    setHint("test hint");
    setAnalysis({
      // V4 minimal fixture — analysis 필드 보존 verify 용 (내용 무관).
      summaryEn: "ok",
      summaryKo: "좋음",
      commonPointsEn: [],
      commonPointsKo: [],
      keyDifferencesEn: [],
      keyDifferencesKo: [],
      domainMatch: "person",
      categoryDiffs: {},
      categoryScores: {},
      keyAnchors: [],
      fidelityScore: null,
      transformPromptEn: "",
      transformPromptKo: "",
      uncertainEn: "",
      uncertainKo: "",
      observation1: {},
      observation2: {},
      provider: "ollama",
      fallback: false,
      analyzedAt: 1000,
      visionModel: "qwen3-vl:8b",
      textModel: "gemma4-un:latest",
    });

    useVisionCompareStore.getState().reset();

    // 모든 필드 초기 상태 (휘발 정책 — 페이지 떠나면 모두 사라짐)
    const state = useVisionCompareStore.getState();
    expect(state.stageHistory).toEqual([]);
    expect(state.hint).toBe("");
    expect(state.analysis).toBeNull();
    expect(state.imageA).toBeNull();
  });
});
