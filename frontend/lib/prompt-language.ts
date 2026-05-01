/**
 * lib/prompt-language — 프롬프트 언어/구조 휴리스틱 (pure functions).
 *
 * Phase 5 후속 (2026-05-01) — UI 비활성 가드 + 사용자 의도 안내에 사용.
 *
 * - hasKorean: 한글 음절/자모 1자라도 포함하는지
 * - hasEnglish: 영문 알파벳 1자라도 포함하는지
 * - countPhrases: comma 또는 newline 으로 분리된 non-empty phrase 개수
 *
 * 실용 정책 (PromptToolsButtons 가 사용):
 * - 한→영 번역 활성 = hasKorean (한글 0이면 번역할 거 없음)
 * - 영→한 번역 활성 = hasEnglish (영문 0이면 번역할 거 없음)
 * - 분리 활성 = countPhrases >= 3 (1~2 phrase 는 분리 의미 X · spec §4.5 권장 5+)
 */

/** 한글 음절 (가-힣) + 자모 (ㄱ-ㅎ, ㅏ-ㅣ) 범위 검사. */
export function hasKorean(text: string): boolean {
  // ㄱ-ㆎ: 한글 자모 (ㄱ-ㅎ, ㅏ-ㅣ 등) · 가-힣: 한글 음절 (가-힣)
  return /[ㄱ-ㆎ가-힣]/u.test(text);
}

/** ASCII 영문 알파벳 검사 (대소문자). */
export function hasEnglish(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

/** comma / newline 기준 non-empty phrase 개수. */
export function countPhrases(text: string): number {
  if (!text.trim()) return 0;
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}
