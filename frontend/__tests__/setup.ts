/**
 * vitest 전역 설정
 * - @testing-library/jest-dom 매처 등록
 * - 글로벌 모의 객체 설정 (jsdom 미지원 API 폴리필)
 */

import '@testing-library/jest-dom/vitest'

// jsdom 은 ResizeObserver 미구현 — BeforeAfterSlider 의 autoMatchAspect 가 사용
if (typeof globalThis.ResizeObserver === 'undefined') {
  // @ts-expect-error — minimal stub (jsdom 한정 · 실제 측정 동작 안 함)
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
