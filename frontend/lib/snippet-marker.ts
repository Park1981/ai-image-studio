/**
 * snippet-marker — `<lib>...</lib>` XML-style 마커 헬퍼.
 *
 * 2026-04-30 (Phase 2B Task 5 · plan 2026-04-30-prompt-snippets-library.md).
 *
 * 정책:
 *  - 라이브러리 카드 toggle 시 textarea 의 prompt 에 `<lib>...</lib>` 으로 감싸 삽입
 *  - 백엔드는 LLM 호출 직전 + 4 위치에서 strip (백엔드 _lib_marker.py 와 의도 동일)
 *  - frontend 는 사용자 visual 표시만 — 마커가 보여도 무방 (실제 전송 시 strip)
 */

const OPEN = "<lib>";
const CLOSE = "</lib>";

/** prompt 를 `<lib>...</lib>` 으로 감싸기. trim 적용. */
export function wrapMarker(prompt: string): string {
  return `${OPEN}${prompt.trim()}${CLOSE}`;
}

/** textarea 안에 해당 prompt 의 마커가 포함되어 있는지. */
export function hasMarker(textarea: string, prompt: string): boolean {
  return textarea.includes(wrapMarker(prompt));
}

/**
 * textarea 에서 해당 prompt 의 마커 1회 제거 + 빈 콤마 정리.
 * 콤마가 양쪽에 남아 ", , " 같이 되는 경우 정리.
 */
export function removeMarker(textarea: string, prompt: string): string {
  const wrapped = wrapMarker(prompt);
  let next = textarea.replace(wrapped, "");
  next = next
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return next;
}

/** 모든 `<lib>` / `</lib>` 토큰 제거 — 안 내용 보존. backend strip 과 동일 의도. */
export function stripAllMarkers(text: string): string {
  return text.split(OPEN).join("").split(CLOSE).join("");
}
