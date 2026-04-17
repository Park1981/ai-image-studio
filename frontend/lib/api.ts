/**
 * FastAPI 백엔드 API 클라이언트
 * 모든 백엔드 통신은 이 모듈을 통해 수행
 */

// 백엔드 API 기본 URL
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

// ── 공통 API 응답 타입 (discriminated union — 타입 안전성 강화) ──
// success=true일 때만 data에 접근 가능 (TS narrowing)
// success=false면 error가 보장됨 → fetchApi의 `null as T` 단언 제거
export type ApiResponse<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: string; data?: undefined }

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

// ── 이미지 수정 요청 타입 ──
export interface EditRequest {
  source_image: string  // 업로드된 이미지 파일명 또는 서버 내 경로
  edit_prompt: string   // 수정 지시 프롬프트
  auto_enhance?: boolean  // AI 프롬프트 보강 여부
  checkpoint?: string   // 체크포인트 이름
  loras?: { name: string; strength_model: number; strength_clip: number }[]
  vae?: string          // VAE 이름
  steps?: number
  cfg?: number
  seed?: number
}

// ── 이미지 업로드 응답 타입 ──
export interface UploadResponse {
  filename: string
  size: number
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
  comfyui: { running: boolean; uptime_min?: number; vram_used_gb?: number; vram_total_gb?: number }
}

// ── 모델 목록 응답 타입 ──
export interface ModelsResponse {
  checkpoints: string[]
  diffusion_models: string[]
  loras: string[]
  vaes: string[]
}

// ── 히스토리 응답 타입 ──
export interface HistoryItem {
  id: string
  prompt: string
  enhanced_prompt: string | null
  negative_prompt: string | null
  checkpoint: string
  loras: { name: string; strength_model: number; strength_clip: number }[]  // 백엔드 스키마와 동기화
  sampler: string
  scheduler: string
  width: number
  height: number
  steps: number
  cfg: number
  seed: number
  images: { url: string; seed: number; filename: string }[]
  created_at: string
}

export interface HistoryListResponse {
  items: HistoryItem[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

export type HistoryDetailResponse = HistoryItem

// ── 프롬프트 템플릿 타입 ──
export interface PromptTemplateCreate {
  name: string
  prompt: string
  negative_prompt: string
  style: string
}

export interface PromptTemplate {
  id: number
  name: string
  prompt: string
  negative_prompt: string
  style: string
  created_at: string | null
}

// ── 모델 프리셋 타입 ──
export interface ModelPresetInfo {
  name: string
  aliases?: string[]
  mode?: string
  sampler: string
  scheduler: string
  steps: number
  cfg: number
  vae?: string
  compatible_loras?: string[]
  default_width: number
  default_height: number
  min_size: number
  max_size: number
  step_size: number
  description: string
}

export interface ModelPresetsResponse {
  diffusion_models: Record<string, ModelPresetInfo>
  checkpoints: Record<string, ModelPresetInfo>
}

// ── AI 보강 카테고리 설정 타입 ──
export interface EnhanceCategoryConfig {
  subject: boolean
  background: boolean
  lighting: boolean
  style: boolean
  mood: boolean
  technical: boolean
}

// ── AI 보강 카테고리 결과 항목 타입 ──
export interface EnhanceCategoryItem {
  name: string        // subject | background | lighting | style | mood | technical
  label_ko: string    // 한국어 라벨
  text_en: string     // 영어 보강 텍스트
  text_ko: string     // 한국어 설명
  auto_filled: boolean // AI가 자동 채운 항목 여부
}

// ── 프롬프트 보강 응답 타입 ──
export interface EnhancePromptResponse {
  original: string
  enhanced: string
  negative: string
  fallback?: boolean  // Ollama 호출 실패 시 폴백 사용 여부
  categories: EnhanceCategoryItem[]  // 카테고리별 상세 결과
  provider?: string  // 보강 제공자: "ollama" | "claude_cli" | "fallback"
}

// ── Ollama 모델 정보 타입 ──
export interface OllamaModelInfo {
  name: string
  size_gb: number
  modified_at: string
}

// 공통 fetch 래퍼 — discriminated union으로 타입 안전성 확보
// 실패 시 `data: null as T` 같은 위험한 단언 없이 `{ success: false, error }` 반환
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
        error: errorData?.error || `서버 오류 (${response.status})`,
      }
    }

    return await response.json()
  } catch {
    return {
      success: false,
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

  /** 이미지 수정 요청 (Qwen Image Edit) */
  generateEdit: (request: EditRequest) =>
    fetchApi<GenerateResponse>('/api/generate/edit', {
      method: 'POST',
      body: JSON.stringify(request),
    }),

  /** 이미지 업로드 (수정 모드 소스 이미지) */
  uploadImage: async (file: File): Promise<ApiResponse<UploadResponse>> => {
    const url = `${API_BASE}/api/images/upload`
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        // Content-Type 헤더를 설정하지 않음 — FormData가 자동으로 boundary 설정
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        return {
          success: false,
          error: errorData?.error || `업로드 실패 (${response.status})`,
        }
      }

      return await response.json()
    } catch {
      return {
        success: false,
        error: '이미지 업로드에 실패했습니다. 서버 연결을 확인해주세요.',
      }
    }
  },

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

  /** 모델별 권장 파라미터 프리셋 조회 */
  getModelPresets: () =>
    fetchApi<ModelPresetsResponse>('/api/models/presets'),

  // ── 프롬프트 보강 API ──

  /** 구조화 프롬프트 AI 보강 */
  enhancePrompt: (
    prompt: string,
    style?: string,
    model?: string,
    options?: {
      mode?: 'generate' | 'edit'
      creativity?: number
      detail_level?: 'minimal' | 'normal' | 'detailed'
      categories?: EnhanceCategoryConfig
      provider?: 'auto' | 'ollama' | 'claude'
    }
  ) =>
    fetchApi<EnhancePromptResponse>('/api/prompt/enhance', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        style,
        model: model || '',
        mode: options?.mode || 'generate',
        creativity: options?.creativity ?? 0.7,
        detail_level: options?.detail_level || 'normal',
        categories: options?.categories,
        provider: options?.provider || 'auto',
      }),
    }),

  /** 비전(이미지 분석) 기반 프롬프트 AI 보강 (수정 모드) */
  enhanceEditPrompt: (
    prompt: string,
    sourceImage: string,
    style?: string,
    model?: string,
    options?: {
      creativity?: number
      detailLevel?: string
      categories?: EnhanceCategoryConfig
    }
  ) =>
    fetchApi<EnhancePromptResponse>('/api/prompt/enhance-with-vision', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        source_image: sourceImage,
        style: style || 'photorealistic',
        ollama_model: model || '',
        creativity: options?.creativity ?? 0.7,
        detail_level: options?.detailLevel || 'normal',
        categories: options?.categories,
      }),
    }),

  /** Ollama 설치된 모델 목록 조회 */
  getOllamaModels: () =>
    fetchApi<OllamaModelInfo[]>('/api/process/ollama/models'),

  // ── 히스토리 API ──

  /** 생성 이력 목록 조회 (검색 지원) */
  getHistory: (page = 1, limit = 20, query = '') => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (query) params.set('q', query)
    return fetchApi<HistoryListResponse>(`/api/history?${params.toString()}`)
  },

  /** 이력 상세 조회 */
  getHistoryDetail: (id: string) =>
    fetchApi<HistoryDetailResponse>(`/api/history/${id}`),

  /** 이력 삭제 */
  deleteHistory: (id: string) =>
    fetchApi<{ id: string; message: string }>(`/api/history/${id}`, {
      method: 'DELETE',
    }),

  // ── 프롬프트 템플릿 API ──

  /** 저장된 프롬프트 템플릿 목록 조회 */
  getTemplates: () =>
    fetchApi<PromptTemplate[]>('/api/prompt/templates'),

  /** 새 프롬프트 템플릿 저장 */
  saveTemplate: (data: PromptTemplateCreate) =>
    fetchApi<PromptTemplate>('/api/prompt/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** 프롬프트 템플릿 삭제 */
  deleteTemplate: (id: number) =>
    fetchApi<{ id: number; message: string }>(`/api/prompt/templates/${id}`, {
      method: 'DELETE',
    }),
}
