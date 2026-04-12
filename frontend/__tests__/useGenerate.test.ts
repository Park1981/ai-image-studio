/**
 * useGenerate 훅 동작 테스트
 * - generate() 호출 플로우 (autoEnhance ON/OFF)
 * - cancel() 호출
 * - 에러 핸들링
 * - api, useWebSocket, useEnhance를 mock
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppStore } from '@/stores/useAppStore'

// ── Mock: api 모듈 ──
const mockGenerate = vi.fn()
const mockCancelGeneration = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    generate: (...args: unknown[]) => mockGenerate(...args),
    cancelGeneration: (...args: unknown[]) => mockCancelGeneration(...args),
    enhancePrompt: vi.fn(),
    enhanceEditPrompt: vi.fn(),
  },
}))

// ── Mock: useWebSocket ──
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
  }),
}))

// ── Mock: useEnhance ──
const mockEnhance = vi.fn()
const mockGetEnhancedResult = vi.fn(() => ({
  finalPrompt: 'enhanced prompt',
  finalNegative: 'enhanced negative',
}))
const mockCancelEnhance = vi.fn()

vi.mock('@/hooks/useEnhance', () => ({
  useEnhance: () => ({
    enhance: mockEnhance,
    getEnhancedResult: mockGetEnhancedResult,
    cancelEnhance: mockCancelEnhance,
    enhancePending: false,
  }),
}))

// ── useGenerate import (mock 설정 후) ──
import { useGenerate } from '@/hooks/useGenerate'

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('useGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // 스토어 초기화
    useAppStore.setState({
      prompt: '',
      negativePrompt: '',
      autoEnhance: true,
      generationStatus: 'idle',
      currentTaskId: null,
      progress: 0,
      errorMessage: null,
      enhancePending: false,
      enhanceFallback: false,
      checkpoint: '',
      loras: [],
      vae: '',
      sampler: 'euler',
      scheduler: 'simple',
      width: 1024,
      height: 1024,
      steps: 25,
      cfg: 7.0,
      seed: -1,
      batchSize: 1,
    })
  })

  it('빈 프롬프트 → 에러 메시지', async () => {
    useAppStore.setState({ prompt: '' })
    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.generate()
    })

    expect(useAppStore.getState().errorMessage).toBe('프롬프트를 입력해주세요.')
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('autoEnhance ON → enhance() 호출', async () => {
    useAppStore.setState({ prompt: 'a cat', autoEnhance: true })
    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.generate()
    })

    expect(mockEnhance).toHaveBeenCalledTimes(1)
    // api.generate는 아직 호출 안 됨 (보강 결과 확인 대기)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('autoEnhance OFF → api.generate 직접 호출', async () => {
    useAppStore.setState({ prompt: 'a landscape', autoEnhance: false })
    mockGenerate.mockResolvedValue({
      success: true,
      data: { task_id: 'task-001' },
    })

    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.generate()
    })

    expect(mockEnhance).not.toHaveBeenCalled()
    expect(mockGenerate).toHaveBeenCalledTimes(1)

    // 요청 파라미터 확인
    const callArgs = mockGenerate.mock.calls[0][0]
    expect(callArgs.prompt).toBe('a landscape')
    expect(callArgs.auto_enhance).toBe(false)
    expect(callArgs.steps).toBe(25)
    expect(callArgs.cfg).toBe(7.0)
  })

  it('생성 성공 → WebSocket 연결 + 상태 업데이트', async () => {
    useAppStore.setState({ prompt: 'sunset', autoEnhance: false })
    mockGenerate.mockResolvedValue({
      success: true,
      data: { task_id: 'task-002' },
    })

    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.generate()
    })

    expect(useAppStore.getState().currentTaskId).toBe('task-002')
    expect(mockConnect).toHaveBeenCalledWith('task-002')
  })

  it('API 에러 → generationStatus error', async () => {
    useAppStore.setState({ prompt: 'test', autoEnhance: false })
    mockGenerate.mockResolvedValue({
      success: false,
      error: '서버 오류',
    })

    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.generate()
    })

    expect(useAppStore.getState().generationStatus).toBe('error')
    expect(useAppStore.getState().errorMessage).toBe('서버 오류')
  })

  it('네트워크 예외 → 에러 처리', async () => {
    useAppStore.setState({ prompt: 'test', autoEnhance: false })
    mockGenerate.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.generate()
    })

    expect(useAppStore.getState().generationStatus).toBe('error')
    expect(useAppStore.getState().errorMessage).toContain('예상치 못한 오류')
  })

  it('confirmEnhance → 보강 결과로 생성', async () => {
    useAppStore.setState({ prompt: 'cat', generationStatus: 'idle' })
    mockGenerate.mockResolvedValue({
      success: true,
      data: { task_id: 'task-003' },
    })

    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.confirmEnhance()
    })

    expect(mockGetEnhancedResult).toHaveBeenCalled()
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    // 보강된 프롬프트가 전달되어야 함
    expect(mockGenerate.mock.calls[0][0].prompt).toBe('enhanced prompt')
  })

  it('cancel → API 호출 + 상태 초기화', async () => {
    useAppStore.setState({ currentTaskId: 'task-004', generationStatus: 'generating' })
    mockCancelGeneration.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.cancel()
    })

    expect(mockCancelGeneration).toHaveBeenCalledWith('task-004')
    expect(useAppStore.getState().generationStatus).toBe('cancelled')
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('cancel 실패 → 에러 메시지', async () => {
    useAppStore.setState({ currentTaskId: 'task-005', generationStatus: 'generating' })
    mockCancelGeneration.mockResolvedValue({ success: false, error: '취소 불가' })

    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.cancel()
    })

    expect(useAppStore.getState().errorMessage).toBe('취소 불가')
  })

  it('currentTaskId 없으면 cancel 무시', async () => {
    useAppStore.setState({ currentTaskId: null })
    const { result } = renderHook(() => useGenerate())

    await act(async () => {
      await result.current.cancel()
    })

    expect(mockCancelGeneration).not.toHaveBeenCalled()
  })

  it('isGenerating 상태 확인', () => {
    const { result, rerender } = renderHook(() => useGenerate())
    expect(result.current.isGenerating).toBe(false)

    act(() => useAppStore.setState({ generationStatus: 'generating' }))
    rerender()
    expect(result.current.isGenerating).toBe(true)

    act(() => useAppStore.setState({ generationStatus: 'warming_up' }))
    rerender()
    expect(result.current.isGenerating).toBe(true)

    act(() => useAppStore.setState({ generationStatus: 'completed' }))
    rerender()
    expect(result.current.isGenerating).toBe(false)
  })
})
