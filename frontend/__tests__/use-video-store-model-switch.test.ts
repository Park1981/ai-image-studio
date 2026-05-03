/**
 * useVideoStore — Phase 4 (2026-05-03 · Wan 2.2 도입) 영상 모델 전환 정책.
 *
 * 검증 시나리오:
 *  - setSelectedVideoModel 의 fan-out (옵션 A · spec §5.6) — useSettingsStore.videoModel 도 같이 갱신
 *  - 모델 전환 시 longerEdge 자동 채움 (사용자 override=false)
 *  - 사용자 override=true 면 모델 전환 시 longerEdge 유지
 *  - setLongerEdge 가 longerEdgeUserOverride=true 활성
 *  - setSource (새 source 업로드) 가 longerEdgeUserOverride=false reset
 *  - 잘못된 model_id 라도 빌더 검증은 useVideoStore 가 안 함 (런타임 type 안전성은 호출부 책임)
 *
 * spec: docs/superpowers/specs/2026-05-03-video-model-selection-wan22.md §5.3
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "@/stores/useSettingsStore";
import {
  VIDEO_LONGER_EDGE_DEFAULT,
  useVideoStore,
} from "@/stores/useVideoStore";

const INITIAL_VIDEO_STATE = useVideoStore.getState();
const INITIAL_SETTINGS_STATE = useSettingsStore.getState();

beforeEach(() => {
  // 매 테스트 전 초기 상태 리셋
  useVideoStore.setState({
    ...INITIAL_VIDEO_STATE,
    selectedVideoModel: "wan22",
    longerEdge: 832, // Wan 22 sweet spot
    longerEdgeUserOverride: false,
    sourceImage: null,
    sourceWidth: null,
    sourceHeight: null,
  });
  useSettingsStore.setState({
    ...INITIAL_SETTINGS_STATE,
    videoModel: "wan22",
  });
});

afterEach(() => {
  useVideoStore.setState(INITIAL_VIDEO_STATE);
  useSettingsStore.setState(INITIAL_SETTINGS_STATE);
});

describe("useVideoStore.setSelectedVideoModel — Phase 4 fan-out", () => {
  it("Wan 22 → LTX 전환 시 settings.videoModel 도 같이 갱신 (옵션 A fan-out)", () => {
    useVideoStore.getState().setSelectedVideoModel("ltx");
    expect(useVideoStore.getState().selectedVideoModel).toBe("ltx");
    expect(useSettingsStore.getState().videoModel).toBe("ltx");
  });

  it("override=false 일 때 모델 전환은 새 모델 sweet spot 으로 longerEdge 자동 채움", () => {
    // 초기: Wan22 832, override=false
    expect(useVideoStore.getState().longerEdgeUserOverride).toBe(false);
    useVideoStore.getState().setSelectedVideoModel("ltx");
    // LTX sweet spot = 1024 (VIDEO_MODEL_PRESETS.ltx.defaultWidth)
    expect(useVideoStore.getState().longerEdge).toBe(1024);
  });

  it("override=true 일 때 모델 전환은 longerEdge 유지", () => {
    // 사용자가 직접 longerEdge 1280 으로 만짐
    useVideoStore.getState().setLongerEdge(1280);
    expect(useVideoStore.getState().longerEdgeUserOverride).toBe(true);
    expect(useVideoStore.getState().longerEdge).toBe(1280);
    // 모델 전환 → longerEdge 유지
    useVideoStore.getState().setSelectedVideoModel("ltx");
    expect(useVideoStore.getState().longerEdge).toBe(1280);
  });

  it("LTX → Wan 22 도 동일하게 작동", () => {
    useVideoStore.setState({ selectedVideoModel: "ltx", longerEdge: 1024 });
    useSettingsStore.setState({ videoModel: "ltx" });
    useVideoStore.getState().setSelectedVideoModel("wan22");
    expect(useVideoStore.getState().selectedVideoModel).toBe("wan22");
    expect(useSettingsStore.getState().videoModel).toBe("wan22");
    // Wan22 sweet spot = 832
    expect(useVideoStore.getState().longerEdge).toBe(832);
  });
});

describe("useVideoStore.setLongerEdge — Phase 4 sticky choice", () => {
  it("setLongerEdge 호출 → longerEdgeUserOverride=true 활성", () => {
    expect(useVideoStore.getState().longerEdgeUserOverride).toBe(false);
    useVideoStore.getState().setLongerEdge(1024);
    expect(useVideoStore.getState().longerEdgeUserOverride).toBe(true);
  });

  it("setLongerEdge 가 8배수 스냅 + 범위 clamp (기존 동작 보존)", () => {
    useVideoStore.getState().setLongerEdge(1023); // 8배수 아님
    expect(useVideoStore.getState().longerEdge).toBe(1016); // floor(1023/8)*8 = 1016
    useVideoStore.getState().setLongerEdge(99999); // 너무 큼
    expect(useVideoStore.getState().longerEdge).toBe(1536); // VIDEO_LONGER_EDGE_MAX
    useVideoStore.getState().setLongerEdge(100); // 너무 작음
    expect(useVideoStore.getState().longerEdge).toBe(512); // VIDEO_LONGER_EDGE_MIN
  });
});

describe("useVideoStore.setSource — Phase 4 새 source = override reset", () => {
  it("새 source 업로드 시 longerEdgeUserOverride=false 로 리셋", () => {
    useVideoStore.getState().setLongerEdge(1280);
    expect(useVideoStore.getState().longerEdgeUserOverride).toBe(true);
    useVideoStore.getState().setSource("data:image/png;base64,xxx", "new.png", 1024, 768);
    expect(useVideoStore.getState().longerEdgeUserOverride).toBe(false);
    expect(useVideoStore.getState().sourceImage).toBeTruthy();
    expect(useVideoStore.getState().sourceWidth).toBe(1024);
  });

  it("setSource(null) 도 동일하게 reset (이미지 해제)", () => {
    useVideoStore.getState().setLongerEdge(1280);
    useVideoStore.getState().setSource(null);
    expect(useVideoStore.getState().longerEdgeUserOverride).toBe(false);
    expect(useVideoStore.getState().sourceImage).toBeNull();
  });
});

describe("기본값 검증 (regression — Phase 4 신규 필드)", () => {
  it("초기 selectedVideoModel = wan22 (DEFAULT_VIDEO_MODEL_ID)", () => {
    // INITIAL_VIDEO_STATE 캡처가 store create 직후라서 default 가 박힘
    const fresh = INITIAL_VIDEO_STATE;
    expect(fresh.selectedVideoModel).toBe("wan22");
    expect(fresh.longerEdgeUserOverride).toBe(false);
    expect(fresh.longerEdge).toBe(VIDEO_LONGER_EDGE_DEFAULT);
  });

  it("초기 settings.videoModel = wan22 (Phase 4 신규 필드)", () => {
    const fresh = INITIAL_SETTINGS_STATE;
    expect(fresh.videoModel).toBe("wan22");
  });
});
