/**
 * HistoryBootstrap - 앱 부트 시 서버 히스토리 hydrate.
 * USE_MOCK=false 일 때만 동작. mode 별 (generate/edit/video) 각 1000 개씩 병렬 fetch → 합쳐서 replaceAll.
 *
 * 2026-05-02: 옛 단일 limit 100 통합 fetch 는 mode 간 cap 충돌 문제 (예: edit 가 100 채우면 generate 0)
 *  → mode 별 분리 fetch + 각 1000 limit 으로 변경. DB 진실 그대로 store 에 들어감.
 *
 * 재시도 정책 (2026-04-24 v2):
 *  - 최대 3회 backoff 재시도 (0.5s → 1.5s → 3s)
 *  - 모든 시도 실패 시에만 markHydrated → toast 1회 표시
 *  - 일시 장애 (백엔드 부팅 지연 등) 가 영구 잠김으로 굳지 않게 함
 *
 * AppShell 에 한 번만 마운트.
 */

"use client";

import { useEffect } from "react";
import { listHistory } from "@/lib/api/history";
import { USE_MOCK } from "@/lib/api/client";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";

const RETRY_DELAYS_MS = [500, 1500, 3000];

export default function HistoryBootstrap() {
  const replaceAll = useHistoryStore((s) => s.replaceAll);
  const markHydrated = useHistoryStore((s) => s.markHydrated);
  const hydrated = useHistoryStore((s) => s.hydrated);

  useEffect(() => {
    if (hydrated) return;
    if (USE_MOCK) {
      markHydrated();
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = async (tryIdx: number): Promise<void> => {
      if (cancelled) return;
      try {
        // mode 별 병렬 fetch — 각 1000 limit. mode 간 cap 충돌 회피.
        const [gen, edit, video] = await Promise.all([
          listHistory({ mode: "generate", limit: 1000 }),
          listHistory({ mode: "edit", limit: 1000 }),
          listHistory({ mode: "video", limit: 1000 }),
        ]);
        if (cancelled) return;
        // createdAt desc 통합 정렬 — store 가 mode 무관 단일 array 라.
        const merged = [...gen.items, ...edit.items, ...video.items].sort(
          (a, b) => b.createdAt - a.createdAt,
        );
        replaceAll(merged);
        markHydrated();
      } catch (e) {
        if (cancelled) return;
        const remaining = RETRY_DELAYS_MS.length - tryIdx - 1;
        if (remaining > 0) {
          // 다음 backoff 로 재시도 — toast 는 마지막 실패에만
          const delay = RETRY_DELAYS_MS[tryIdx + 1];
          console.warn(
            `history hydrate try ${tryIdx + 1} failed, retry in ${delay}ms:`,
            e,
          );
          timer = setTimeout(() => attempt(tryIdx + 1), delay);
        } else {
          // 최종 실패 — hydrated 표기 + 사용자 안내
          markHydrated();
          toast.warn(
            "히스토리 동기화 실패",
            "로컬 저장본만 표시됨. 백엔드 상태 확인 후 새로고침.",
          );
          console.warn("history hydrate gave up:", e);
        }
      }
    };

    attempt(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hydrated, replaceAll, markHydrated]);

  return null;
}
