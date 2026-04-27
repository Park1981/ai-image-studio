/**
 * HistoryBootstrap - 앱 부트 시 서버 히스토리 hydrate.
 * USE_MOCK=false 일 때만 동작. /api/studio/history 에서 최신 100 개 가져와서 replaceAll.
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
        const { items } = await listHistory({ limit: 100 });
        if (cancelled) return;
        replaceAll(items);
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
