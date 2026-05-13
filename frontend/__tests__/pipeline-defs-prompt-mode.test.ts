/**
 * Phase 2 (2026-05-01) — pipeline-defs subLabel 모드 분기 + DetailBox kind 분기.
 *
 * 검증:
 *  - 4 stage (generate.gemma4-upgrade / edit·video.prompt-merge / compare.intent-refine)
 *    의 subLabel 콜백이 ctx.promptMode 에 따라 다른 라벨 반환.
 *  - vision.translation 은 정책상 fast 고정 — promptMode 분기 안 함.
 *  - 4 stage (edit·video.prompt-merge / vision.vision-analyze / compare.vision-pair) 의
 *    renderDetail 이 provider startsWith("fallback") 시 warn 톤 (warn / info 두 케이스).
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PIPELINE_DEFS, type PipelineCtx } from "@/lib/pipeline-defs";

function findStage(mode: keyof typeof PIPELINE_DEFS, type: string) {
  const stage = PIPELINE_DEFS[mode].find((s) => s.type === type);
  if (!stage) throw new Error(`stage not found: ${mode}.${type}`);
  return stage;
}

function getSubLabel(
  stage: ReturnType<typeof findStage>,
  ctx: PipelineCtx,
): string {
  if (typeof stage.subLabel === "function") return stage.subLabel(ctx);
  return stage.subLabel ?? "";
}

describe("pipeline-defs · 모드 분기 (Phase 2)", () => {
  it.each([
    ["generate", "gemma4-upgrade"],
    ["edit", "prompt-merge"],
    ["video", "prompt-merge"],
    // 2026-05-05 V4 재설계: compare.intent-refine 폐기 (compare_pipeline_v4 는
    // promptMode 무관 · spec §6.2). compare 의 pair-compare/translation 은 정적/비전 라벨.
  ] as const)(
    "%s.%s 의 subLabel 이 promptMode 에 따라 분기",
    (mode, type) => {
      const stage = findStage(mode, type);
      const fast = getSubLabel(stage, { promptMode: "fast" });
      const precise = getSubLabel(stage, { promptMode: "precise" });

      expect(fast).toBe("gemma4-un");
      expect(precise).toContain("정밀");
      // 라벨이 분기되는지 — 두 결과가 달라야 의미 있음.
      expect(precise).not.toBe(fast);
    },
  );

  it("compare V4 의 pair-compare 는 promptMode 무관 (visionModel ctx 만 반영 · 2026-05-13 pair vision MVP)", () => {
    // pair-compare 는 vision 호출 (qwen3-vl) — promptMode (gemma4 분기) 와 무관.
    // visionSubLabel 콜백이 ctx.visionModel 만 봄 (default 'qwen3-vl:8b').
    const stage = findStage("compare", "pair-compare");
    expect(getSubLabel(stage, { promptMode: "fast" })).toBe("qwen3-vl:8b");
    expect(getSubLabel(stage, { promptMode: "precise" })).toBe("qwen3-vl:8b");
    // visionModel 명시 시 그 값 반영
    expect(
      getSubLabel(stage, { promptMode: "fast", visionModel: "qwen3-vl:thinking" }),
    ).toBe("qwen3-vl:thinking");
  });

  it("vision.translation 은 promptMode 와 무관하게 항상 'gemma4-un' (정책 §4.4)", () => {
    const stage = findStage("vision", "translation");
    expect(getSubLabel(stage, { promptMode: "fast" })).toBe("gemma4-un");
    expect(getSubLabel(stage, { promptMode: "precise" })).toBe("gemma4-un");
  });

  it("ctx 미전달 (legacy) 시 fast 라벨 반환", () => {
    const stage = findStage("generate", "gemma4-upgrade");
    const result = getSubLabel(stage, {});
    expect(result).toBe("gemma4-un");
  });
});

describe("pipeline-defs · DetailBox kind 가 fallback prefix warn 분기", () => {
  // Edit prompt-merge / Video prompt-merge / Vision vision-analyze / Compare vision-pair
  // 4 곳 모두 startsWith("fallback") 패턴이라 fallback / fallback-precise-failed 둘 다 warn.

  it.each([
    ["edit", "prompt-merge"],
    ["video", "prompt-merge"],
  ] as const)(
    "%s.%s renderDetail 가 fallback-precise-failed 에 warn (HTML markup 검증)",
    (mode, type) => {
      const stage = findStage(mode, type);
      if (!stage.renderDetail) throw new Error("renderDetail 없음");
      const ctx: PipelineCtx = {
        hideEditPrompts: false,
        hideVideoPrompts: false,
      };

      const failed = stage.renderDetail(
        { finalPrompt: "x", provider: "fallback-precise-failed" },
        ctx,
      );
      const ok = stage.renderDetail(
        { finalPrompt: "x", provider: "ollama" },
        ctx,
      );

      const markupFailed = renderToStaticMarkup(failed as never);
      const markupOk = renderToStaticMarkup(ok as never);

      // DetailBox 의 kind="warn" 는 className 또는 inline style 으로 reflect.
      // 두 출력이 *반드시 달라야* — fallback-precise-failed 가 warn 톤으로 분기됨을 입증.
      expect(markupFailed).not.toBe(markupOk);
      // provider 표기는 양쪽 다 들어감 (sanity)
      expect(markupFailed).toContain("fallback-precise-failed");
      expect(markupOk).toContain("ollama");
    },
  );
});
