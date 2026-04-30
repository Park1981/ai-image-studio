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

/**
 * 2026-04-30 (단일 활성 정책 fix · 오빠 결정):
 * 모든 `<lib>...</lib>` *블록* 통째로 제거 (마커 + 안 내용 둘 다).
 * 빈 콤마/공백 정리까지 포함 — 라이브러리 카드 단일 활성 흐름에서 사용.
 *
 * stripAllMarkers 와 차이: 저건 *마커 토큰* 만 제거 + 안 내용 보존,
 * 이건 *블록 전체* (안 내용 포함) 제거.
 */
export function stripAllLibBlocks(text: string): string {
  let next = text.replace(/<lib>[\s\S]*?<\/lib>/g, "");
  // 연속 콤마-공백 그룹 (", , ," 등) 을 하나의 ", " 로 압축 → lastIndex 함정 우회.
  next = next
    .replace(/(,\s*){2,}/g, ", ")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return next;
}
