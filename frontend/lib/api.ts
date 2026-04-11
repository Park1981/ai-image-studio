/**
 * FastAPI 백엔드 API 클라이언트
 * 모든 백엔드 통신은 이 모듈을 통해 수행
 */

// 백엔드 API 기본 URL
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

// ── 공통 API 응답 타입 ──
export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

// ── 생성 요청 타입 ──
export interface GenerateRequest {
  prompt: string
  negative_prompt?: string
  checkpoint?: string
  loras?: { name: string; strength_model: number; strength_clip: number }[]
  vae?: string
  sampler?: string
  scheduler?: string
  width?: number
  height?: number
  steps?: number
  cfg?: number
  seed?: number
  batch_size?: number
  auto_enhance?: boolean
}

// ── 생성 응답 타입 ──
export interface GenerateResponse {
  task_id: string
  status: string
  prompt_enhanced: string
  negative_prompt: string
  comfyui_started: boolean
}

// ── 태스크 상태 응답 타입 ──
export interface TaskStatusResponse {
  task_id: string
  status: string
  progress: number
  images: { url: string; seed: number; filename: string }[]
  error: string | null
}

// ── 프로세스 상태 응답 타입 ──
export interface ProcessStatusResponse {
  ollama: { running: boolean }
  comfyui: { running: boolean; uptime_min?: number }
}

// ── 모델 목록 응답 타입 ──
export interface ModelsResponse {
  checkpoints: string[]
  loras: string[]
  vaes: string[]
}

// ── 프롬프트 보강 응답 타입 ──
export interface EnhancePromptResponse {
  original: string
  enhanced: string
  negative: string
}

// 공통 fetch 래퍼 (에러 처리 포함)
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${endpoint}`

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      return {
        success: false,
        data: null as T,
        error: errorData?.error || `서버 오류 (${response.status})`,
      }
    }

    return await response.json()
  } catch {
    return {
      success: false,
      data: null as T,
      error: '서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해주세요.',
    }
  }
}

// ── API 메서드 ──
export const api = {
  // 범용 GET 요청
  get: <T>(endpoint: string) => fetchApi<T>(endpoint),

  // 범용 POST 요청
  post: <T>(endpoint: string, body: unknown) =>
    fetchApi<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // 범용 DELETE 요청
  delete: <T>(endpoint: string) =>
    fetchApi<T>(endpoint, { method: 'DELETE' }),

  // WebSocket 연결 URL 생성
  wsUrl: (path: string) => {
    const wsBase = API_BASE.replace('http', 'ws')
    return `${wsBase}${path}`
  },

  // ── 이미지 생성 API ──

  /** 이미지 생성 요청 */
  generate: (request: GenerateRequest) =>
    fetchApi<GenerateResponse>('/api/generate', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  /** 이미지 생성 취소 */
  cancelGeneration: (taskId: string) =>
    fetchApi<{ interrupted: boolean; message: string }>(
      `/api/generate/cancel/${taskId}`,
      { method: 'POST' }
    ),

  /** 태스크 상태 조회 */
  getTaskStatus: (taskId: string) =>
    fetchApi<TaskStatusResponse>(`/api/generate/status/${taskId}`),

  // ── 프로세스 관리 API ──

  /** 프로세스 상태 조회 (Ollama, ComfyUI) */
  getProcessStatus: () =>
    fetchApi<ProcessStatusResponse>('/api/process/status'),

  /** ComfyUI 시작 */
  startComfyUI: () =>
    fetchApi<{ message: string }>('/api/process/comfyui/start', {
      method: 'POST',
    }),

  /** ComfyUI 종료 */
  stopComfyUI: () =>
    fetchApi<{ message: string }>('/api/process/comfyui/stop', {
      method: 'POST',
    }),

  // ── 모델 관리 API ──

  /** 사용 가능한 모델 목록 조회 */
  getModels: () =>
    fetchApi<ModelsResponse>('/api/models/list'),

  // ── 프롬프트 보강 API ──

  /** 프롬프트 AI 보강 */
  enhancePrompt: (prompt: string, style?: string) =>
    fetchApi<EnhancePromptResponse>('/api/prompt/enhance', {
      method: 'POST',
      body: JSON.stringify({ prompt, style }),
    }),
}
