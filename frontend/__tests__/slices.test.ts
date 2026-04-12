/**
 * Zustand 슬라이스 단위 테스트
 * - promptSlice: 프롬프트 상태 변경
 * - generationSlice: 생성 상태/진행률
 * - settingsSlice: 파라미터 기본값/변경
 * - modelSlice: 체크포인트/LoRA/VAE
 * - uiSlice: UI 상태 토글
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/stores/useAppStore'

// ── 매 테스트 전 스토어 리셋 ──
beforeEach(() => {
  // Zustand 상태 초기화 (getState + setState로 원래 값 복원)
  const { setState } = useAppStore
  setState({
    // promptSlice 초기값
    prompt: '',
    negativePrompt: '',
    enhancedPrompt: '',
    autoEnhance: true,
    enhancePending: false,
    enhancedNegative: '',
    enhanceFallback: false,
    enhanceProvider: 'ollama',
    activeStyleHint: 'photorealistic',
    ollamaModel: '',
    enhancedCategories: [],

    // generationSlice 초기값
    generationStatus: 'idle',
    progress: 0,
    currentTaskId: null,
    generatedImages: [],
    errorMessage: null,

    // settingsSlice 초기값
    sampler: 'euler',
    scheduler: 'simple',
    width: 1328,
    height: 1328,
    steps: 50,
    cfg: 4.0,
    seed: -1,
    batchSize: 4,
  })
})

// ─────────────────────────────────────────────
// promptSlice
// ─────────────────────────────────────────────

describe('promptSlice', () => {
  it('프롬프트 설정/읽기', () => {
    const { setPrompt } = useAppStore.getState()
    setPrompt('a beautiful sunset')
    expect(useAppStore.getState().prompt).toBe('a beautiful sunset')
  })

  it('네거티브 프롬프트 설정', () => {
    const { setNegativePrompt } = useAppStore.getState()
    setNegativePrompt('ugly, blurry')
    expect(useAppStore.getState().negativePrompt).toBe('ugly, blurry')
  })

  it('autoEnhance 토글', () => {
    expect(useAppStore.getState().autoEnhance).toBe(true)
    useAppStore.getState().setAutoEnhance(false)
    expect(useAppStore.getState().autoEnhance).toBe(false)
  })

  it('보강 대기 상태(enhancePending) 설정', () => {
    useAppStore.getState().setEnhancePending(true)
    expect(useAppStore.getState().enhancePending).toBe(true)
  })

  it('보강 제공자(provider) 변경', () => {
    useAppStore.getState().setEnhanceProvider('claude_cli')
    expect(useAppStore.getState().enhanceProvider).toBe('claude_cli')
  })

  it('스타일 힌트 변경', () => {
    useAppStore.getState().setActiveStyleHint('anime')
    expect(useAppStore.getState().activeStyleHint).toBe('anime')
  })

  it('AI 보강 세부 설정 — creativity 변경', () => {
    useAppStore.getState().setEnhanceSettings({ creativity: 0.9 })
    const settings = useAppStore.getState().enhanceSettings
    expect(settings.creativity).toBe(0.9)
    // 나머지 값은 유지
    expect(settings.detailLevel).toBe('normal')
  })

  it('AI 보강 카테고리 개별 토글', () => {
    useAppStore.getState().setEnhanceCategory('technical', true)
    expect(useAppStore.getState().enhanceSettings.categories.technical).toBe(true)
    // 다른 카테고리는 유지
    expect(useAppStore.getState().enhanceSettings.categories.subject).toBe(true)
  })

  it('보강 결과 카테고리 데이터 설정', () => {
    const cats = [
      { name: 'subject', label_ko: '피사체', text_en: 'cat', text_ko: '고양이', auto_filled: false },
    ]
    useAppStore.getState().setEnhancedCategories(cats)
    expect(useAppStore.getState().enhancedCategories).toHaveLength(1)
    expect(useAppStore.getState().enhancedCategories[0].name).toBe('subject')
  })
})

// ─────────────────────────────────────────────
// generationSlice
// ─────────────────────────────────────────────

describe('generationSlice', () => {
  it('초기 상태 idle', () => {
    expect(useAppStore.getState().generationStatus).toBe('idle')
  })

  it('생성 상태 전이: idle → warming_up → generating → completed', () => {
    const store = useAppStore.getState()
    store.setGenerationStatus('warming_up')
    expect(useAppStore.getState().generationStatus).toBe('warming_up')

    store.setGenerationStatus('generating')
    expect(useAppStore.getState().generationStatus).toBe('generating')

    store.setGenerationStatus('completed')
    expect(useAppStore.getState().generationStatus).toBe('completed')
  })

  it('진행률 업데이트', () => {
    useAppStore.getState().setProgress(75)
    expect(useAppStore.getState().progress).toBe(75)
  })

  it('태스크 ID 설정/해제', () => {
    useAppStore.getState().setCurrentTaskId('abc123')
    expect(useAppStore.getState().currentTaskId).toBe('abc123')

    useAppStore.getState().setCurrentTaskId(null)
    expect(useAppStore.getState().currentTaskId).toBeNull()
  })

  it('생성된 이미지 저장', () => {
    const images = [
      { url: '/images/test.png', seed: 42, filename: 'test.png' },
      { url: '/images/test2.png', seed: 99, filename: 'test2.png' },
    ]
    useAppStore.getState().setGeneratedImages(images)
    expect(useAppStore.getState().generatedImages).toHaveLength(2)
    expect(useAppStore.getState().generatedImages[0].seed).toBe(42)
  })

  it('에러 메시지 설정/초기화', () => {
    useAppStore.getState().setErrorMessage('ComfyUI 연결 실패')
    expect(useAppStore.getState().errorMessage).toBe('ComfyUI 연결 실패')

    useAppStore.getState().setErrorMessage(null)
    expect(useAppStore.getState().errorMessage).toBeNull()
  })
})

// ─────────────────────────────────────────────
// settingsSlice
// ─────────────────────────────────────────────

describe('settingsSlice', () => {
  it('기본값 확인', () => {
    const state = useAppStore.getState()
    expect(state.sampler).toBe('euler')
    expect(state.scheduler).toBe('simple')
    expect(state.width).toBe(1328)
    expect(state.height).toBe(1328)
    expect(state.steps).toBe(50)
    expect(state.cfg).toBe(4.0)
    expect(state.seed).toBe(-1)
    expect(state.batchSize).toBe(4)
  })

  it('sampler 변경', () => {
    useAppStore.getState().setSampler('dpmpp_2m')
    expect(useAppStore.getState().sampler).toBe('dpmpp_2m')
  })

  it('scheduler 변경', () => {
    useAppStore.getState().setScheduler('karras')
    expect(useAppStore.getState().scheduler).toBe('karras')
  })

  it('해상도 변경', () => {
    useAppStore.getState().setWidth(768)
    useAppStore.getState().setHeight(512)
    expect(useAppStore.getState().width).toBe(768)
    expect(useAppStore.getState().height).toBe(512)
  })

  it('steps 변경', () => {
    useAppStore.getState().setSteps(30)
    expect(useAppStore.getState().steps).toBe(30)
  })

  it('cfg 변경', () => {
    useAppStore.getState().setCfg(7.5)
    expect(useAppStore.getState().cfg).toBe(7.5)
  })

  it('seed 설정', () => {
    useAppStore.getState().setSeed(12345)
    expect(useAppStore.getState().seed).toBe(12345)
  })

  it('batchSize 변경', () => {
    useAppStore.getState().setBatchSize(2)
    expect(useAppStore.getState().batchSize).toBe(2)
  })
})
