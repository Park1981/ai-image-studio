/**
 * ImageLightbox - 전체화면 이미지 뷰어 + 확대/축소/드래그/더블클릭 리셋.
 *
 * 조작:
 *  - 마우스 휠: zoom in/out (커서 위치 기준)
 *  - 드래그: pan (zoom > 1 일 때)
 *  - 더블클릭: 100% ↔ 200% 토글
 *  - ESC, overlay 클릭: 닫기
 *  - +/-/0 키: zoom control
 *
 * 외부에서는 <ImageLightbox src={url} alt="..." onClose={...} /> 로 사용.
 * src 가 null 이면 렌더 안 함.
 *
 * 2026-04-30 (Phase 3.4 · refactor doc §R1):
 *   본체 LightboxInner (340줄) + clamp + ToolBtn 은 lightbox/LightboxInner.tsx 로 분리.
 *   이 파일은 Props 인터페이스 + key 리셋 wrapper 만 담당.
 */

"use client";

import LightboxInner, { type LightboxProps } from "./lightbox/LightboxInner";

export default function ImageLightbox(props: LightboxProps) {
  if (!props.src) return null;
  // key 로 src 변경 시 내부 state 리셋 (setState-in-effect 안티패턴 회피)
  return <LightboxInner key={props.src} {...props} />;
}
