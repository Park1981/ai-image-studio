/**
 * pipeline-defs-consistency.test.ts — PIPELINE_DEFS 정적 검증.
 *
 * 잠재 버그 자동 검출:
 *   - 한 mode 안에서 같은 stage type 중복 X (PipelineTimeline byType Map 충돌 방지)
 *   - 5 mode 모두 핵심 stage 정의됨 (gen/edit/video 의 comfyui-sampling 등)
 *   - label / subLabel 길이 sane (UI 깨짐 방지)
 *   - enabled 콜백이 boolean 반환
 *
 * Phase 3 (2026-04-27) 의 잠재 버그 (PIPELINE_DEFS.video 의 workflow-build vs
 * 백엔드 emit workflow-dispatch type 미스매칭) 같은 사례 자동 차단.
 */

import { describe, expect, it } from "vitest";
import { PIPELINE_DEFS, type PipelineMode } from "@/lib/pipeline-defs";

const ALL_MODES: PipelineMode[] = [
  "generate",
  "edit",
  "video",
  "vision",
  "compare",
];

describe("PIPELINE_DEFS — 정적 일관성", () => {
  it("5 mode 모두 stage 배열 정의됨 (빈 배열 X)", () => {
    for (const mode of ALL_MODES) {
      const stages = PIPELINE_DEFS[mode];
      expect(stages, `mode "${mode}" stages`).toBeDefined();
      expect(stages.length, `mode "${mode}" stages length > 0`).toBeGreaterThan(
        0,
      );
    }
  });

  it("한 mode 안에서 같은 stage type 중복 없음 (byType Map 충돌 방지)", () => {
    for (const mode of ALL_MODES) {
      const types = PIPELINE_DEFS[mode].map((s) => s.type);
      const uniqueTypes = new Set(types);
      expect(types.length, `mode "${mode}" 중복 stage type`).toBe(
        uniqueTypes.size,
      );
    }
  });

  it("모든 stage 가 type + label 필수", () => {
    for (const mode of ALL_MODES) {
      for (const stage of PIPELINE_DEFS[mode]) {
        expect(stage.type, `${mode} stage type 누락`).toBeTruthy();
        expect(stage.type, `${mode}.${stage.type} type 패턴`).toMatch(
          /^[a-z][a-z0-9-]*$/,
        );
        expect(stage.label, `${mode}.${stage.type} label 누락`).toBeTruthy();
        // label 길이 1-15 — UI row 깨짐 방지
        expect(
          stage.label.length,
          `${mode}.${stage.type} label "${stage.label}" 길이 1-15`,
        ).toBeLessThanOrEqual(15);
      }
    }
  });

  it("subLabel 정의된 경우 비어있지 않음 + 길이 sane", () => {
    // Phase 2 (2026-05-01) — subLabel 이 string | (ctx) => string 두 형태 지원.
    // 콜백 형태는 fast / precise 두 분기 모두 sane 검증.
    for (const mode of ALL_MODES) {
      for (const stage of PIPELINE_DEFS[mode]) {
        if (stage.subLabel === undefined) continue;
        if (typeof stage.subLabel === "string") {
          expect(
            stage.subLabel,
            `${mode}.${stage.type} subLabel 빈 문자열`,
          ).toBeTruthy();
          expect(
            stage.subLabel.length,
            `${mode}.${stage.type} subLabel "${stage.subLabel}" 길이 1-30`,
          ).toBeLessThanOrEqual(30);
        } else {
          // 함수: fast / precise 두 ctx 로 호출해 결과 검증
          for (const promptMode of ["fast", "precise"] as const) {
            const result = stage.subLabel({ promptMode });
            expect(
              result,
              `${mode}.${stage.type} subLabel(${promptMode}) 빈 문자열`,
            ).toBeTruthy();
            expect(
              result.length,
              `${mode}.${stage.type} subLabel(${promptMode})="${result}" 길이 1-30`,
            ).toBeLessThanOrEqual(30);
          }
        }
      }
    }
  });

  it("핵심 stage 존재 — gen/edit/video 의 comfyui-sampling + save-output", () => {
    const samplingModes: PipelineMode[] = ["generate", "edit", "video"];
    for (const mode of samplingModes) {
      const types = PIPELINE_DEFS[mode].map((s) => s.type);
      expect(types, `${mode} 에 comfyui-sampling 누락`).toContain(
        "comfyui-sampling",
      );
      expect(types, `${mode} 에 save-output 누락`).toContain("save-output");
    }
  });

  it("ComfyUI 미사용 mode (vision/compare) 는 comfyui-* stage 없음", () => {
    for (const mode of ["vision", "compare"] as const) {
      const types = PIPELINE_DEFS[mode].map((s) => s.type);
      expect(types, `${mode} 에 comfyui-sampling 있으면 안 됨`).not.toContain(
        "comfyui-sampling",
      );
      expect(types, `${mode} 에 comfyui-warmup 있으면 안 됨`).not.toContain(
        "comfyui-warmup",
      );
    }
  });

  it("vision 의 핵심 stage — encoding + analyze + translation", () => {
    const types = PIPELINE_DEFS.vision.map((s) => s.type);
    expect(types).toEqual(
      expect.arrayContaining(["vision-encoding", "vision-analyze", "translation"]),
    );
  });

  it("compare 의 핵심 stage — V4 5 stage (encoding/observe1/observe2/pair-compare/translation)", () => {
    // 2026-05-13 pair vision MVP: diff-synth → pair-compare.
    const types = PIPELINE_DEFS.compare.map((s) => s.type);
    expect(types).toEqual([
      "compare-encoding",
      "observe1",
      "observe2",
      "pair-compare",
      "translation",
    ]);
  });

  it("ComfyUI 자동 기동 stage 는 항상 enabled 조건 있음", () => {
    // gen/edit/video 의 comfyui-warmup 은 항상 자동 기동 시만 표시 (enabled 콜백 필수)
    for (const mode of ["generate", "edit", "video"] as const) {
      const warmup = PIPELINE_DEFS[mode].find(
        (s) => s.type === "comfyui-warmup",
      );
      expect(warmup, `${mode} 에 comfyui-warmup stage 누락`).toBeDefined();
      expect(
        warmup?.enabled,
        `${mode}.comfyui-warmup 이 enabled 콜백 없음 (항상 표시되면 사용자 혼란)`,
      ).toBeTypeOf("function");
    }
  });

  it("gemma4 translation stage 는 enabled 콜백 — gemma4Off 토글 게이트", () => {
    // vision/compare 의 translation 은 gemma4 토글 추가 시 자동 숨김 (옵션 B 통일 가치)
    for (const mode of ["vision", "compare"] as const) {
      const trans = PIPELINE_DEFS[mode].find((s) => s.type === "translation");
      expect(trans, `${mode} 에 translation stage 누락`).toBeDefined();
      expect(
        trans?.enabled,
        `${mode}.translation 에 enabled 콜백 누락 (gemma4 토글 미래 호환)`,
      ).toBeTypeOf("function");
      // gemma4Off=true → false (숨김), gemma4Off=false → true (표시)
      expect(trans?.enabled?.({ gemma4Off: true })).toBe(false);
      expect(trans?.enabled?.({ gemma4Off: false })).toBe(true);
    }
  });

  it("compare V4 — observe1/observe2 가 visionSubLabel 콜백 (settings.visionModel 반영)", () => {
    // 2026-05-05 V4 재설계: 옛 intent-refine + vision-pair 폐기 → observe1/observe2
    // 두 stage 모두 visionSubLabel 콜백 사용 — 사용자가 토글한 비전 모델 (8B/Thinking) 동적 표기.
    for (const type of ["observe1", "observe2"] as const) {
      const stage = PIPELINE_DEFS.compare.find((s) => s.type === type);
      expect(stage, `compare.${type} stage 누락`).toBeDefined();
      expect(stage?.subLabel).toBeTypeOf("function");
      // visionModel 전달 시 그 값 그대로 반환
      const cb = stage!.subLabel as (c: { visionModel?: string }) => string;
      expect(cb({ visionModel: "qwen3-vl:8b-thinking-q8_0" })).toBe(
        "qwen3-vl:8b-thinking-q8_0",
      );
      expect(cb({})).toBe("qwen3-vl:8b"); // 폴백
    }
  });

  it("Generate 의 claude-research 는 research 토글 게이트", () => {
    const research = PIPELINE_DEFS.generate.find(
      (s) => s.type === "claude-research",
    );
    expect(research?.enabled).toBeTypeOf("function");
    expect(research?.enabled?.({ research: true })).toBe(true);
    expect(research?.enabled?.({ research: false })).toBe(false);
  });
});
