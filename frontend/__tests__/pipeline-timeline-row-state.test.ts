/**
 * pipeline-timeline-row-state.test.ts — PipelineTimeline row state 로직 단위 테스트.
 *
 * 2026-04-30 추가 (codex 의견 fix 회귀 방지):
 *   - 옛 nextIdx 로직 → 새 activeIdx 로직 전환 시 회귀 차단
 *   - 핵심 시나리오: ComfyUI sampling 진행 중 마지막 도착 stage 가 RUNNING + live elapsed
 *
 * 검증 대상:
 *   - computeRowState — done / running / pending 판정 (순수 함수)
 *   - computeElapsedFor — 다음 stage 도착 후 elapsed 계산
 *   - computeLiveElapsed — running 중 live 경과 시간 (음수 clamp 포함)
 */

import { describe, expect, it } from "vitest";
import {
  computeElapsedFor,
  computeLiveElapsed,
  computeRowState,
} from "@/components/studio/progress/PipelineTimeline";
import type { StageEvent } from "@/stores/useGenerateStore";

/** 테스트용 StageEvent 헬퍼 — type / arrivedAt 만 의미 있는 단순 더미. */
function ev(type: string, arrivedAt: number, payload: object = {}): StageEvent {
  return { type, payload, arrivedAt } as StageEvent;
}

describe("computeRowState — codex activeIdx 로직", () => {
  it("running 중 마지막 도착 stage 는 running, 이전은 done", () => {
    // ComfyUI sampling 한창 (5번째 도착, 6번째 save-output 미도착) 시나리오.
    const activeIdx = 4; // 0-based — comfyui-sampling row
    const cases = [
      { i: 0, arrived: true, expected: { isDone: true, isRunning: false } },
      { i: 1, arrived: true, expected: { isDone: true, isRunning: false } },
      { i: 2, arrived: true, expected: { isDone: true, isRunning: false } },
      { i: 3, arrived: true, expected: { isDone: true, isRunning: false } },
      { i: 4, arrived: true, expected: { isDone: false, isRunning: true } },
      { i: 5, arrived: false, expected: { isDone: false, isRunning: false } },
    ];
    for (const c of cases) {
      const got = computeRowState({
        i: c.i,
        arrived: c.arrived,
        running: true,
        activeIdx,
      });
      expect(got, `i=${c.i}`).toEqual(c.expected);
    }
  });

  it("running=false 면 모든 도착 stage 가 done (마지막 stage 도)", () => {
    // 파이프라인 끝난 직후 — 모든 도착 row done.
    const activeIdx = 6; // order.length 가정 (running=false 일 때)
    const got1 = computeRowState({
      i: 5,
      arrived: true,
      running: false,
      activeIdx,
    });
    expect(got1).toEqual({ isDone: true, isRunning: false });

    const got2 = computeRowState({
      i: 6,
      arrived: true,
      running: false,
      activeIdx,
    });
    expect(got2).toEqual({ isDone: true, isRunning: false });
  });

  it("미도착 stage 는 항상 pending (둘 다 false)", () => {
    const got = computeRowState({
      i: 5,
      arrived: false,
      running: true,
      activeIdx: 3,
    });
    expect(got).toEqual({ isDone: false, isRunning: false });
  });

  it("아직 한 stage 도 도착 안 한 시작 직후 (activeIdx=-1) 모든 row pending", () => {
    // arrivedIdx = -1 일 때 activeIdx = -1
    for (let i = 0; i < 5; i++) {
      const got = computeRowState({
        i,
        arrived: false,
        running: true,
        activeIdx: -1,
      });
      expect(got, `i=${i}`).toEqual({ isDone: false, isRunning: false });
    }
  });

  it("Minor 가드 — i===activeIdx 라도 arrived=false 면 isRunning=false", () => {
    // codex Minor 의견: enabled 필터된 order 와 stageHistory race 방어.
    // 이론적으론 activeIdx 가 매번 stageHistory 기반으로 계산되니 arrived=true 가
    // 보장되지만, 가드 추가가 더 안전.
    const got = computeRowState({
      i: 3,
      arrived: false,
      running: true,
      activeIdx: 3,
    });
    expect(got).toEqual({ isDone: false, isRunning: false });
  });

  it("회귀 가드 — ComfyUI sampling row 가 도착 즉시 done 되던 옛 버그 차단", () => {
    // 옛 로직 (nextIdx = arrivedIdx + 1): comfyui-sampling 도착 → i < nextIdx → done
    // 새 로직 (activeIdx = arrivedIdx): comfyui-sampling 도착 → i === activeIdx → running
    const got = computeRowState({
      i: 4, // comfyui-sampling 인덱스
      arrived: true,
      running: true,
      activeIdx: 4, // 마지막 도착 = comfyui-sampling
    });
    expect(got.isRunning).toBe(true);
    expect(got.isDone).toBe(false);
  });
});

describe("computeElapsedFor — 다음 stage 도착 시점 기반 elapsed", () => {
  it("다음 stage 가 있으면 (다음 - 본인) / 1000 toFixed(1)", () => {
    const history = [
      ev("a", 1000),
      ev("b", 4500),
      ev("c", 7800),
    ];
    expect(computeElapsedFor(history, "a")).toBe("3.5");
    expect(computeElapsedFor(history, "b")).toBe("3.3");
  });

  it("마지막 stage 는 null (다음 없음 → 계산 불가)", () => {
    const history = [ev("a", 1000), ev("b", 5000)];
    expect(computeElapsedFor(history, "b")).toBeNull();
  });

  it("미도착 stage 는 null", () => {
    const history = [ev("a", 1000)];
    expect(computeElapsedFor(history, "missing")).toBeNull();
  });

  it("회귀 가드 — comfyui-sampling 중복 emit 시 첫 도착 ~ 다른 type 다음 도착", () => {
    // 백엔드가 progress 마다 여러 번 emit 하는 실제 시나리오:
    //   workflow-dispatch (0s) → comfyui-sampling progress 5%/30%/70%/95% (0.5~50s) → save-output (60s)
    // 옛 로직: idx + 1 다음 element = 첫 progress 사이 간격 (0.3 같은 작은 값)
    // 새 로직: 다른 type (save-output) 첫 도착까지 = 60.0 (전체 sampling 시간)
    const history = [
      ev("workflow-dispatch", 0),
      ev("comfyui-sampling", 500), // 시작 (5% progress)
      ev("comfyui-sampling", 15000), // 30% progress
      ev("comfyui-sampling", 35000), // 70% progress
      ev("comfyui-sampling", 50000), // 95% progress
      ev("save-output", 60500), // 다음 stage 시작
    ];
    // workflow-dispatch elapsed: comfyui-sampling 첫 도착 - workflow-dispatch = 0.5
    expect(computeElapsedFor(history, "workflow-dispatch")).toBe("0.5");
    // comfyui-sampling elapsed: save-output - comfyui-sampling 첫 도착 = 60.0 (전체 sampling)
    expect(computeElapsedFor(history, "comfyui-sampling")).toBe("60.0");
  });

  it("같은 type 만 연속 + 다른 type 없음 → null (마지막에 도달)", () => {
    const history = [
      ev("comfyui-sampling", 1000),
      ev("comfyui-sampling", 5000),
      ev("comfyui-sampling", 10000),
    ];
    expect(computeElapsedFor(history, "comfyui-sampling")).toBeNull();
  });
});

describe("computeLiveElapsed — running 중 live 경과", () => {
  it("일반 케이스 (now > arrived) — 초 단위 toFixed(1)", () => {
    expect(computeLiveElapsed(1000, 4500)).toBe("3.5");
    expect(computeLiveElapsed(0, 12345)).toBe("12.3");
  });

  it("now === arrived 면 0.0", () => {
    expect(computeLiveElapsed(5000, 5000)).toBe("0.0");
  });

  it("음수 (clock skew) 는 0.0 으로 clamp", () => {
    expect(computeLiveElapsed(5000, 1000)).toBe("0.0");
  });
});
