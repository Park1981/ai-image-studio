/**
 * lib/api/client.ts — 공용 HTTP/SSE 유틸.
 * 2026-04-23 Opus S3: Mock 스위치, STUDIO_BASE, parseSSE, 이미지 정규화, 내부 헬퍼.
 */

import type { HistoryItem } from "./types";

export const USE_MOCK =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_USE_MOCK !== "false"
    : true;

export const STUDIO_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STUDIO_API) ||
  "http://localhost:8001";

/* ─────────────────────────────────
   내부 유틸 (Mock 생성기 공용)
   ───────────────────────────────── */

export const sleep = (ms: number) =>
  new Promise((r) => setTimeout(r, ms));

export const uid = (prefix = "id") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function resolveSeed(seed: number): number {
  return seed && seed > 0 ? seed : Math.floor(Math.random() * 1e15);
}

/**
 * 백엔드가 반환한 imageRef 를 절대 URL 로 정규화.
 * - "/images/..." → `${STUDIO_BASE}/images/...` (기본 http://localhost:8001)
 * - 나머지 (data:, blob:, http(s):, mock-seed:, etc.) 는 그대로.
 * 이 처리를 api-client 에 모아두면 ImageTile 은 절대 URL 만 받음.
 */
export function normalizeImageRef(ref: string): string {
  if (ref.startsWith("/")) return `${STUDIO_BASE}${ref}`;
  return ref;
}

/** HistoryItem 의 imageRef 필드를 정규화해서 반환 */
export function normalizeItem(item: HistoryItem): HistoryItem {
  return { ...item, imageRef: normalizeImageRef(item.imageRef) };
}

/**
 * SSE 스트림 파서 — fetch 의 ReadableStream 을 `event: X\ndata: {...}\n\n` 단위로 끊어서 yield.
 *
 * 설계 결정:
 *  - data 는 반드시 JSON object (구 버전에서 string fallback 허용했는데 호출처들은
 *    `as { item: ... }` 로 cast 하고 있어서 런타임 버그 유발 → JSON 실패 시 skip).
 *  - `:` 로 시작하는 라인(heartbeat/comment) 은 SSE 스펙상 무시.
 *  - try/finally 로 reader.releaseLock() 보장 — 호출자가 break 하거나
 *    예외로 빠져나가도 리소스 정리.
 */
export async function* parseSSE(
  response: Response,
): AsyncGenerator<
  { event: string; data: Record<string, unknown> },
  void,
  unknown
> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE body missing");
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          // SSE 주석 (":" 시작) — heartbeat 등, 무시
          if (line.startsWith(":")) continue;
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:"))
            dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) {
          const raw = dataLines.join("\n");
          try {
            const parsed = JSON.parse(raw);
            // 객체만 수용 — 배열/primitive 면 호출처 cast 가 암묵적 버그가 되므로 skip
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              yield {
                event: eventName,
                data: parsed as Record<string, unknown>,
              };
            }
            // object 가 아니면 SSE 프레임이긴 하지만 우리 프로토콜엔 없음 → drop.
          } catch {
            // JSON 깨짐 — 드롭 (로그도 안 남김: 스트림 신호 노이즈 줄이기)
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // 호출자가 break/throw 로 탈출해도 body stream lock 해제
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
