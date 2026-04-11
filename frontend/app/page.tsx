/**
 * AI Image Studio 메인 페이지
 * 프롬프트 입력, 설정, 이미지 생성/결과 표시
 */

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* 헤더 영역 */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
        <h1 className="text-lg font-semibold">AI Image Studio</h1>
        <div className="flex items-center gap-3 text-sm">
          {/* Phase 1에서 StatusIndicator 컴포넌트로 교체 */}
          <span className="text-zinc-500">Ollama: --</span>
          <span className="text-zinc-500">ComfyUI: --</span>
          <button className="px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors">
            설정
          </button>
        </div>
      </header>

      {/* 메인 컨텐츠 */}
      <main className="flex flex-1 gap-4 p-4">
        {/* 좌측: 이미지 결과 + 프롬프트 영역 */}
        <div className="flex flex-col flex-1 gap-4">
          {/* 이미지 결과 그리드 (Phase 1에서 ImageGrid 컴포넌트로 교체) */}
          <div className="flex-1 flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
            <p className="text-zinc-500">이미지 생성 결과가 여기에 표시됩니다</p>
          </div>

          {/* 프롬프트 입력 (Phase 1에서 PromptInput 컴포넌트로 교체) */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <textarea
              className="w-full bg-transparent resize-none outline-none placeholder-zinc-600 text-sm"
              rows={3}
              placeholder="이미지를 설명해주세요... (한국어 입력 가능)"
            />
            <div className="flex items-center justify-between mt-2">
              <div className="flex gap-2">
                <button className="px-3 py-1.5 text-sm rounded-md bg-zinc-800 hover:bg-zinc-700 transition-colors">
                  AI 보강
                </button>
              </div>
              <button className="px-4 py-1.5 text-sm rounded-md bg-indigo-600 hover:bg-indigo-500 font-medium transition-colors">
                🎨 생성
              </button>
            </div>
          </div>
        </div>

        {/* 우측: 설정 사이드바 (Phase 2에서 SettingsPanel로 교체) */}
        <aside className="w-64 rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-4 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-400">생성 설정</h2>
          <div className="space-y-3 text-sm text-zinc-500">
            <p>모델 선택</p>
            <p>LoRA 선택</p>
            <p>사이즈</p>
            <p>Steps</p>
            <p>CFG</p>
            <p>Seed</p>
            <p>Batch</p>
            <p>Sampler</p>
          </div>
        </aside>
      </main>

      {/* 하단: 최근 히스토리 (Phase 3에서 구현) */}
      <footer className="px-4 py-2 border-t border-zinc-800">
        <p className="text-xs text-zinc-600">📋 최근 히스토리 (Phase 3에서 구현)</p>
      </footer>
    </div>
  );
}
