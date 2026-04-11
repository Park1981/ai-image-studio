/**
 * AI Image Studio 디자인 토큰
 * 컬러, 간격, 타이포그래피, 그림자 등 전역 디자인 시스템 정의
 * ⚠️ 변경 시 사용자 확인 필수
 */

// 컬러 팔레트 (Phase 0.5에서 사용자 피드백 후 확정)
export const colors = {
  // 다크 테마 기본
  bg: {
    primary: '#0a0a0a',
    secondary: '#141414',
    tertiary: '#1e1e1e',
    hover: '#262626',
  },
  text: {
    primary: '#fafafa',
    secondary: '#a1a1aa',
    muted: '#71717a',
  },
  accent: {
    primary: '#6366f1',    // 인디고 (메인 액센트)
    hover: '#818cf8',
    muted: '#6366f1/20',
  },
  status: {
    success: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  },
  border: {
    default: '#27272a',
    hover: '#3f3f46',
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
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  md: '0 4px 6px rgba(0, 0, 0, 0.4)',
  lg: '0 10px 15px rgba(0, 0, 0, 0.5)',
} as const

// 라운딩
export const borderRadius = {
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const

// 트랜지션
export const transitions = {
  fast: '150ms ease',
  normal: '200ms ease',
  slow: '300ms ease',
} as const
