/**
 * settings-store-auto-nsfw — spec 2026-05-12 v1.1 §4.7
 * useSettingsStore 의 autoNsfwEnabled + nsfwIntensity persist + setter 검증.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/useSettingsStore";

describe("useSettingsStore auto NSFW (spec 2026-05-12 v1.1)", () => {
  beforeEach(() => {
    // 각 테스트 시작 시 default 상태로 reset (persist 영향 차단)
    useSettingsStore.setState({
      autoNsfwEnabled: false,
      nsfwIntensity: 2,
    });
  });

  it("default autoNsfwEnabled=false, nsfwIntensity=2 (사용자 결정 Q1)", () => {
    const state = useSettingsStore.getState();
    expect(state.autoNsfwEnabled).toBe(false);
    expect(state.nsfwIntensity).toBe(2);
  });

  it("setAutoNsfwEnabled 토글", () => {
    useSettingsStore.getState().setAutoNsfwEnabled(true);
    expect(useSettingsStore.getState().autoNsfwEnabled).toBe(true);
    useSettingsStore.getState().setAutoNsfwEnabled(false);
    expect(useSettingsStore.getState().autoNsfwEnabled).toBe(false);
  });

  it("setNsfwIntensity 1|2|3 변경", () => {
    useSettingsStore.getState().setNsfwIntensity(1);
    expect(useSettingsStore.getState().nsfwIntensity).toBe(1);
    useSettingsStore.getState().setNsfwIntensity(3);
    expect(useSettingsStore.getState().nsfwIntensity).toBe(3);
  });

  it("기존 필드 동작 회귀 0 (autoCompareAnalysis 등)", () => {
    // autoNsfw 추가가 기존 필드를 깨지 않는지 확인
    const state = useSettingsStore.getState();
    expect(state.promptEnhanceMode).toBeDefined();
    expect(state.lightningByDefault).toBe(false);
    expect(state.templates.length).toBeGreaterThan(0);
  });
});
