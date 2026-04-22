/**
 * HistoryBootstrap - 앱 부트 시 서버 히스토리 hydrate.
 * USE_MOCK=false 일 때만 동작. /api/studio/history 에서 최신 100 개 가져와서 replaceAll.
 *
 * AppShell 에 한 번만 마운트.
 */

"use client";

import { useEffect } from "react";
import { listHistory, USE_MOCK } from "@/lib/api-client";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";

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
    (async () => {
      try {
        const { items } = await listHistory({ limit: 100 });
        if (!cancelled) {
          replaceAll(items);
          markHydrated();
        }
      } catch (e) {
        if (!cancelled) {
          markHydrated();
          toast.warn(
            "히스토리 동기화 실패",
            "로컬 저장본만 표시됨. 백엔드 상태 확인.",
          );
          console.warn("history hydrate failed:", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, replaceAll, markHydrated]);

  return null;
}
