/**
 * 프리셋 시스템
 * 기본 제공 프리셋 + 사용자 커스텀 프리셋 (localStorage)
 */

export interface Preset {
  id: string
  name: string
  icon: string  // 이모지
  builtin: boolean  // 기본 제공 여부
  styleHint: string  // AI 보강 시 전달할 스타일 힌트
  params: {
    sampler: string
    scheduler: string
    steps: number
    cfg: number
    width: number
    height: number
  }
}

/** 기본 제공 프리셋 */
export const BUILTIN_PRESETS: Preset[] = [
  {
    id: 'photorealistic',
    name: '포토리얼',
    icon: '📷',
    builtin: true,
    styleHint: 'photorealistic',
    params: { sampler: 'euler', scheduler: 'simple', steps: 50, cfg: 4, width: 1328, height: 1328 },
  },
  {
    id: 'portrait',
    name: '인물 세로',
    icon: '🧑',
    builtin: true,
    styleHint: 'portrait',
    params: { sampler: 'euler', scheduler: 'simple', steps: 50, cfg: 4, width: 928, height: 1664 },
  },
  {
    id: 'landscape',
    name: '풍경 가로',
    icon: '🏔️',
    builtin: true,
    styleHint: 'landscape',
    params: { sampler: 'euler', scheduler: 'simple', steps: 50, cfg: 4, width: 1664, height: 928 },
  },
  {
    id: 'fast',
    name: '빠른 생성',
    icon: '⚡',
    builtin: true,
    styleHint: 'photorealistic',
    params: { sampler: 'euler', scheduler: 'simple', steps: 20, cfg: 4, width: 1024, height: 1024 },
  },
  {
    id: 'highquality',
    name: '고품질',
    icon: '💎',
    builtin: true,
    styleHint: 'cinematic',
    params: { sampler: 'euler', scheduler: 'simple', steps: 80, cfg: 5, width: 1328, height: 1328 },
  },
]

const STORAGE_KEY = 'ais-custom-presets'

/** 사용자 커스텀 프리셋 로드 */
export function loadCustomPresets(): Preset[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** 사용자 커스텀 프리셋 저장 */
export function saveCustomPresets(presets: Preset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
}

/** 전체 프리셋 목록 (기본 + 커스텀) */
export function getAllPresets(): Preset[] {
  return [...BUILTIN_PRESETS, ...loadCustomPresets()]
}
