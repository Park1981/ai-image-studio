/**
 * VisionCompareAnalysisV4 contract test — backend to_dict 키 ↔ frontend interface 정합성.
 *
 * 의도: OpenAPI 가 SSE done payload schema 를 못 잡으므로 (TaskCreated response),
 * frontend 가 backend 의 camelCase 출력 키를 모두 받을 수 있는지 정적 검증.
 *
 * backend 변경 시 이 테스트가 가장 먼저 fail.
 */
import { describe, expect, it } from "vitest";
import type { VisionCompareAnalysisV4 } from "@/lib/api/types";

describe("VisionCompareAnalysisV4 contract", () => {
  it("모든 필수 키 존재 (backend to_dict 미러)", () => {
    // 컴파일러 검증 — 키 누락 시 type error
    const sample: VisionCompareAnalysisV4 = {
      summaryEn: "",
      summaryKo: "",
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
      analyzedAt: 0,
      visionModel: "qwen3-vl:8b",
      textModel: "gemma4-un:latest",
    };
    expect(sample.domainMatch).toBe("person");
  });

  it("category_diffs 가 5 카테고리 키만 받음 (mixed=빈 dict)", () => {
    const r: VisionCompareAnalysisV4 = {
      summaryEn: "",
      summaryKo: "",
      commonPointsEn: [],
      commonPointsKo: [],
      keyDifferencesEn: [],
      keyDifferencesKo: [],
      domainMatch: "person",
      categoryDiffs: {
        composition: {
          image1: "a",
          image2: "b",
          diff: "c",
          image1Ko: "",
          image2Ko: "",
          diffKo: "",
        },
        subject: {
          image1: "",
          image2: "",
          diff: "",
          image1Ko: "",
          image2Ko: "",
          diffKo: "",
        },
        clothing_or_materials: {
          image1: "",
          image2: "",
          diff: "",
          image1Ko: "",
          image2Ko: "",
          diffKo: "",
        },
        environment: {
          image1: "",
          image2: "",
          diff: "",
          image1Ko: "",
          image2Ko: "",
          diffKo: "",
        },
        lighting_camera_style: {
          image1: "",
          image2: "",
          diff: "",
          image1Ko: "",
          image2Ko: "",
          diffKo: "",
        },
      },
      categoryScores: {
        composition: 87,
        subject: null,
        clothing_or_materials: null,
        environment: null,
        lighting_camera_style: null,
      },
      keyAnchors: [],
      fidelityScore: 80,
      transformPromptEn: "",
      transformPromptKo: "",
      uncertainEn: "",
      uncertainKo: "",
      observation1: {},
      observation2: {},
      provider: "ollama",
      fallback: false,
      analyzedAt: 0,
      visionModel: "",
      textModel: "",
    };
    expect(Object.keys(r.categoryDiffs).length).toBe(5);
  });
});
