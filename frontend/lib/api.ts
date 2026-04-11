/**
 * FastAPI 백엔드 API 클라이언트
 * 모든 백엔드 통신은 이 모듈을 통해 수행
 */

// 백엔드 API 기본 URL
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

// 공통 API 응답 타입
export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
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
  } catch (error) {
    return {
      success: false,
      data: null as T,
      error: '서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해주세요.',
    }
  }
}

// API 메서드
export const api = {
  // GET 요청
  get: <T>(endpoint: string) => fetchApi<T>(endpoint),

  // POST 요청
  post: <T>(endpoint: string, body: unknown) =>
    fetchApi<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // DELETE 요청
  delete: <T>(endpoint: string) =>
    fetchApi<T>(endpoint, { method: 'DELETE' }),

  // WebSocket 연결 URL 생성
  wsUrl: (path: string) => {
    const wsBase = API_BASE.replace('http', 'ws')
    return `${wsBase}${path}`
  },
}
