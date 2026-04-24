/**
 * AI Image Studio 디자인 토큰
 * 컬러, 간격, 타이포그래피, 그림자 등 전역 디자인 시스템 정의
 * ⚠️ 변경 시 사용자 확인 필수
 */

// 컬러 팔레트 (globals.css 의 warm neutral 시스템과 동기화)
export const colors = {
  // 라이트 테마 기본
  bg: {
    primary: '#FAF9F7',
    secondary: '#F4F2EE',
    tertiary: '#FFFFFF',
    hover: '#F4F2EE',
  },
  text: {
    primary: '#1F1F1F',
    secondary: '#46464A',
    muted: '#7A7A80',
  },
  accent: {
    primary: '#4A9EFF',
    hover: '#1E7BE0',
    muted: '#EAF3FF',
  },
  status: {
    success: '#52C41A',
    error: '#D94A5C',
    warning: '#FAAD14',
    info: '#4A9EFF',
  },
  border: {
    default: '#E8E5DF',
    hover: '#DCD8D0',
  },
} as const

// 간격 시스템 (4px 기반)
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
  '4xl': '64px',
} as const

// 타이포그래피
export const typography = {
  fontFamily: {
    sans: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
  },
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
  },
} as const

// 그림자
export const shadows = {
  sm: '0 1px 2px rgba(23, 20, 14, 0.04), 0 2px 8px rgba(23, 20, 14, 0.04)',
  md: '0 2px 4px rgba(23, 20, 14, 0.04), 0 8px 24px rgba(23, 20, 14, 0.06)',
  lg: '0 4px 10px rgba(23, 20, 14, 0.05), 0 20px 48px rgba(23, 20, 14, 0.08)',
} as const

// 라운딩 (audit R1-5 · globals.css 와 동기)
// sm 버튼·pill / md 입력·토스트 / card 결과카드(primary) / lg 모달 / xl 예약 / full 원형
export const borderRadius = {
  sm: '8px',
  md: '12px',
  card: '14px',
  lg: '16px',
  xl: '20px',
  full: '9999px',
} as const

// 기능 토큰 (audit R1-1/3 · warm neutral 체계 확장)
export const semantic = {
  accentDisabled: '#C8D6E8',
  bgDark: '#0A0A0C',
  overlayDark: 'rgba(10, 10, 12, 0.48)',
} as const

// 트랜지션
export const transitions = {
  fast: '150ms ease',
  normal: '200ms ease',
  slow: '300ms ease',
} as const
