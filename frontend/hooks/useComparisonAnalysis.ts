/**
 * useComparisonAnalysis - Edit 결과 vs 원본 비교 분석 트리거 + 캐시 관리.
 *
 * 책임:
 *  - analyze(item): 수동 또는 자동 분석 호출 + per-item busy guard
 *  - 분석 결과를 useHistoryStore.replaceAll 로 inline patch (item 갱신)
 *  - VRAM 임계 (>13GB) 시 자동 호출은 skip + 토스트 (수동은 경고만)
 *  - 동일 item 중복 호출 차단 (Set<itemId> busy)
 *  - 백엔드 mutex 가 ComfyUI 와 직렬화 — 프론트는 토스트로 안내
 *
 * 반환:
 *  - analyze(item, opts?): 외부 트리거 진입점
 *  - isBusy(itemId): 특정 item 분석 중 여부 (UI 가 카드 state 분기)
 */

"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { compareAnalyze } from "@/lib/api/compare";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";
import type { ComparisonAnalysis, HistoryItem } from "@/lib/api/types";

/** RTX 4070 Ti SUPER 16GB 기준 — ComfyUI + qwen2.5vl 동시 실행 OOM 방지 임계치 */
const VRAM_THRESHOLD_GB = 13;

/**
 * 모듈 전역 busy set — 페이지 간에도 동일 set 공유.
 * /edit 페이지와 ImageLightbox 양쪽에서 동일 item 중복 분석 방지.
 */
const _busy = new Set<string>();
const _listeners = new Set<() => void>();

/** busy set 변경 시 모든 구독자에게 알림 */
function _notify() {
  for (const fn of _listeners) fn();
}

/** useSyncExternalStore 용 subscribe 함수 */
function _subscribe(fn: () => void) {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** useSyncExternalStore 용 snapshot 함수 — busy set 의 현재 참조 반환 */
function _snapshot(): ReadonlySet<string> {
  return _busy;
}

export interface AnalyzeOptions {
  /** true 면 자동 모드 — VRAM 초과/사용자 작업 중일 때 silent skip */
  silent?: boolean;
}

export function useComparisonAnalysis() {
  // 외부 store(busy set) 구독 — isBusy 변경 시 카드가 리렌더 받게
  // SSR(서버) snapshot 도 동일 함수 전달 — Next.js 16 에서 문제 없음
  useSyncExternalStore(_subscribe, _snapshot, _snapshot);

  const visionModel = useSettingsStore((s) => s.visionModel);
  const ollamaModel = useSettingsStore((s) => s.ollamaModel);
  const items = useHistoryStore((s) => s.items);
  const replaceAll = useHistoryStore((s) => s.replaceAll);
  const vram = useProcessStore((s) => s.vram);

  // 비동기 콜백에서도 stale 클로저 회피 — 최신 items 보관
  const itemsRef = useRef(items);
  itemsRef.current = items;

  /** 특정 item 의 분석 진행 중 여부 */
  const isBusy = useCallback((itemId: string) => _busy.has(itemId), []);

  const analyze = useCallback(
    async (item: HistoryItem, opts: AnalyzeOptions = {}) => {
      // ── 사전 가드 4단계 ──────────────────────────────────────────

      // 1) Edit 모드 항목만 비교 분석 가능
      if (item.mode !== "edit") {
        if (!opts.silent) toast.warn("비교 분석은 Edit 결과만 가능");
        return;
      }

      // 2) sourceRef 없는 옛 항목 (재설계 이전 생성) 는 스킵
      if (!item.sourceRef) {
        if (!opts.silent) toast.warn("원본 이미지가 저장되지 않은 이전 항목입니다.");
        return;
      }

      // 3) 동일 item 중복 호출 차단
      if (_busy.has(item.id)) {
        if (!opts.silent) toast.warn("이미 분석이 진행 중입니다.", "잠시 후 다시 시도해 주세요.");
        return;
      }

      // 4) VRAM 임계 검사 — 자동(silent) 모드는 skip, 수동은 경고 후 진행
      if (vram && vram.usedGb > VRAM_THRESHOLD_GB) {
        if (opts.silent) {
          toast.warn(
            "VRAM 부족 · 자동 분석 skip",
            `${vram.usedGb.toFixed(1)}GB > ${VRAM_THRESHOLD_GB}GB`,
          );
          return;
        }
        // 수동 호출 — 경고 토스트만 띄우고 분석은 계속 시도
        toast.warn(
          "VRAM 높음 · 분석 시도",
          `${vram.usedGb.toFixed(1)}GB · 진행 가능`,
        );
      }

      // ── 분석 실행 ────────────────────────────────────────────────

      _busy.add(item.id);
      _notify();

      try {
        const { analysis: rawAnalysis, saved } = await compareAnalyze({
          source: item.sourceRef,
          result: item.imageRef,
          editPrompt: item.prompt,
          // Codex C1 fix (2026-04-30): history.id 는 gen-/edit-/vid- prefix 라서
          // 옛 startsWith("tsk-") 게이트로는 절대 통과 X → store 휘발 상태였음.
          // 백엔드 HISTORY_ID_RE 가 형식 검증 + update_comparison rowcount 로 안전 차단.
          historyItemId: item.id,
          visionModel,
          ollamaModel,
        });
        // 이 훅은 Edit context 전용이라 응답이 항상 ComparisonAnalysis (Edit 5축).
        // compareAnalyze 의 응답 union 을 좁혀서 HistoryItem.comparisonAnalysis 에 할당.
        const analysis = rawAnalysis as ComparisonAnalysis;

        // 결과를 store 의 해당 item 에만 inline patch (다른 item 영향 없음)
        const next = itemsRef.current.map((x) =>
          x.id === item.id ? { ...x, comparisonAnalysis: analysis } : x,
        );
        replaceAll(next);

        // ── 완료 토스트 분기 ─────────────────────────────────────
        if (analysis.fallback) {
          // 비전 모델 응답 부족 → fallback 결과
          toast.warn("비교 분석 fallback", analysis.summary_ko || "비전 응답 부족");
        } else if (!opts.silent) {
          // 수동 호출 성공
          toast.success("비교 분석 완료", `종합 ${analysis.overall}%`);
        } else {
          // 자동 모드 성공 — 짧게 info 토스트
          toast.info("비교 분석 도착", `종합 ${analysis.overall}%`);
        }

        // DB 저장 실패 경고 — historyItemId 전달했는데 saved=false
        if (item.id.startsWith("tsk-") && !saved) {
          toast.warn("DB 저장 실패", "재시작 후 결과가 사라질 수 있습니다.");
        }
      } catch (err) {
        toast.error(
          "비교 분석 실패",
          err instanceof Error ? err.message : "알 수 없는 오류",
        );
      } finally {
        // 성공/실패 관계없이 busy 해제 — 누수 방지
        _busy.delete(item.id);
        _notify();
      }
    },
    [vram, visionModel, ollamaModel, replaceAll],
  );

  return { analyze, isBusy };
}
