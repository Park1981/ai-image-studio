/**
 * 영상 출력 사이즈 경고 임계 + 공용 비율 유틸.
 *
 * spec: docs/superpowers/specs/2026-05-04-video-size-warn-modal-design.md (v1.4)
 *
 * store/component 어느 쪽에도 결합되지 않은 순수 함수로 유지 — 테스트 시 mock 불필요.
 * 추후 Edit/Generate 모드도 같은 임계 정책을 쓰면 그대로 재사용 가능.
 */

/** 한 변이라도 이 값 이상이면 경고 모달 트리거 (W or H 단일 임계). */
export const VIDEO_WARN_LONGER_EDGE = 1280;

/** 가로/세로 *둘 다* 이 값 이상이면 경고 모달 트리거 (양방 결합 임계). */
export const VIDEO_WARN_BOTH_EDGE = 1000;

/**
 * 출력 W×H 가 경고 임계를 충족하는지.
 *
 * 가드:
 *  - NaN / Infinity → false (계산 꼬임 안전망)
 *  - ≤ 0 → false (소스 미선택 시 expected = {0, 0} 차단)
 */
export function shouldWarnVideoSize(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;

  return (
    width >= VIDEO_WARN_LONGER_EDGE ||
    height >= VIDEO_WARN_LONGER_EDGE ||
    (width >= VIDEO_WARN_BOTH_EDGE && height >= VIDEO_WARN_BOTH_EDGE)
  );
}

/**
 * 정수 비율 근사 — "16:9" / "3:4" 등.
 *
 * 가드 (2-layer):
 *  - 1차: NaN / Infinity / ≤ 0 → "-" 반환
 *  - 소수 입력 정수 스냅: Math.round 적용 후 GCD
 *  - 2차: round 결과 ≤ 0 → "-" 반환 (예: 0.4×0.4 → 0×0 race 방지)
 */
export function simplifyRatio(w: number, h: number): string {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return "-";
  }

  const wi = Math.round(w);
  const hi = Math.round(h);
  if (wi <= 0 || hi <= 0) return "-";

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(wi, hi);
  return `${wi / g}:${hi / g}`;
}
