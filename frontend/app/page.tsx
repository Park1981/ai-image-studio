"use client";

import { useState } from "react";

/**
 * AI Image Studio — 메인 생성 페이지
 * 이미지가 주인공, 나머지는 도구
 */

/* ─────────────────────────────────
   헤더
   ───────────────────────────────── */
function Header() {
  return (
    <header className="flex items-center justify-between px-5 h-12 border-b border-edge shrink-0">
      {/* 로고 */}
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center shadow-[0_0_12px_rgba(124,58,237,0.3)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.912 5.813a2 2 0 001.272 1.278L21 12l-5.816 1.91a2 2 0 00-1.272 1.278L12 21l-1.912-5.813a2 2 0 00-1.272-1.278L3 12l5.816-1.91a2 2 0 001.272-1.278z" />
          </svg>
        </div>
        <h1 className="text-[15px] font-semibold tracking-tight font-[family-name:var(--font-sora)]">
          AI Image Studio
        </h1>
      </div>

      {/* 상태 + 네비 */}
      <div className="flex items-center gap-2.5">
        <StatusPill label="Ollama" status="running" />
        <StatusPill label="ComfyUI" status="stopped" />
        <div className="w-px h-4 bg-edge mx-1" />
        <NavButton icon={<ClockIcon />} label="히스토리" />
        <NavButton icon={<GearIcon />} label="설정" />
      </div>
    </header>
  );
}

function StatusPill({ label, status }: { label: string; status: "running" | "stopped" }) {
  const isRunning = status === "running";
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${isRunning ? "bg-ok/10 text-ok" : "bg-white/[0.03] text-text-dim"}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-ok pulse-live" : "bg-text-ghost"}`} />
      {label}
    </div>
  );
}

function NavButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-text-sub hover:text-text hover:bg-white/[0.04] transition-all text-xs" title={label}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/* ─────────────────────────────────
   이미지 그리드
   ───────────────────────────────── */
function ImageGrid() {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-1.5 p-2 min-h-0 overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <button
          key={i}
          onClick={() => setSelected(i === selected ? null : i)}
          className={`relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${
            selected === i
              ? "ring-2 ring-accent-bright ring-offset-2 ring-offset-void scale-[0.99]"
              : "ring-1 ring-edge hover:ring-edge-hover"
          }`}
        >
          {/* 빈 상태 플레이스홀더 */}
          <div className="w-full h-full shimmer flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 opacity-20">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" className="text-text-sub">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <span className="text-[10px] font-mono text-text-sub">{i + 1}</span>
            </div>
          </div>

          {/* 선택 시 체크마크 */}
          {selected === i && (
            <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-lg">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          )}

          {/* 번호 뱃지 */}
          <div className="absolute bottom-2.5 left-2.5 px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm text-[10px] font-mono text-text-sub">
            #{i + 1}
          </div>
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────
   프롬프트 입력 독
   ───────────────────────────────── */
function PromptDock() {
  const [prompt, setPrompt] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);

  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="prompt-glow rounded-xl bg-surface border border-edge transition-all">
        {/* 프롬프트 입력 */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="이미지를 설명해주세요... (한국어 입력 가능)"
          rows={2}
          className="w-full bg-transparent resize-none outline-none px-4 pt-3 pb-1 text-[13px] placeholder-text-ghost leading-relaxed"
        />

        {/* 하단 액션 바 */}
        <div className="flex items-center justify-between px-2.5 pb-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsEnhancing(!isEnhancing)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                isEnhancing ? "bg-accent-muted text-accent-bright" : "text-text-sub hover:text-text hover:bg-white/[0.04]"
              }`}
            >
              <SparkleIcon />
              AI 보강
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-text-sub hover:text-text hover:bg-white/[0.04] transition-all">
              <XCircleIcon />
              네거티브
            </button>
            <span className="text-[10px] text-text-ghost ml-1.5 hidden md:inline">Ctrl+Enter</span>
          </div>

          {/* 생성 버튼 */}
          <button className="btn-glow flex items-center gap-1.5 px-5 py-2 rounded-lg text-white text-[13px] font-semibold">
            <BoltIcon />
            생성
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────
   설정 사이드바
   ───────────────────────────────── */
function SettingsSidebar() {
  return (
    <aside className="w-[240px] shrink-0 border-l border-edge bg-ground/60 flex flex-col overflow-y-auto overflow-x-hidden">
      {/* 모델 */}
      <Section title="모델">
        <Label text="체크포인트" />
        <select className="input-field text-[11px] font-mono">
          <option>sdxl_base_1.0.safetensors</option>
          <option>realisticVision_v51.safetensors</option>
          <option>dreamshaper_8.safetensors</option>
        </select>
        <Label text="VAE" mt />
        <select className="input-field text-[11px] font-mono">
          <option>기본값 (모델 내장)</option>
          <option>sdxl_vae.safetensors</option>
        </select>
      </Section>

      {/* LoRA */}
      <Section title="LoRA">
        <div className="space-y-2">
          <LoraItem name="detail_enhancer" strength={0.7} />
          <LoraItem name="anime_style" strength={0.5} />
        </div>
        <button className="mt-2.5 flex items-center gap-1.5 text-[11px] text-accent-bright hover:text-accent transition-colors w-full justify-center py-1.5 rounded-lg border border-dashed border-edge hover:border-edge-accent">
          <PlusIcon /> LoRA 추가
        </button>
      </Section>

      {/* 설정 */}
      <Section title="설정">
        <div className="space-y-3">
          <SliderField label="Steps" value={25} min={1} max={100} />
          <SliderField label="CFG" value={7.0} min={1} max={20} step={0.5} />
          <SliderField label="Denoise" value={1.0} min={0} max={1} step={0.05} />

          <Label text="사이즈" />
          <div className="grid grid-cols-3 gap-1">
            {["512", "768", "1024"].map((s) => (
              <button key={s} className={`py-1.5 text-[10px] font-mono rounded-md transition-all ${
                s === "1024"
                  ? "bg-accent-muted text-accent-bright ring-1 ring-edge-accent"
                  : "bg-ground text-text-sub hover:bg-elevated ring-1 ring-edge"
              }`}>
                {s}
              </button>
            ))}
          </div>

          <Label text="시드" mt />
          <div className="flex gap-1.5">
            <input type="text" defaultValue="-1" className="input-field font-mono text-[11px] flex-1" />
            <button className="px-2 rounded-md bg-ground ring-1 ring-edge hover:ring-edge-hover text-text-sub hover:text-text transition-all" title="랜덤">
              <RefreshIcon />
            </button>
          </div>

          <Label text="배치 수" mt />
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} className={`py-1.5 text-[11px] font-mono rounded-md transition-all ${
                n === 4
                  ? "bg-accent-muted text-accent-bright ring-1 ring-edge-accent"
                  : "bg-ground text-text-sub hover:bg-elevated ring-1 ring-edge"
              }`}>
                {n}
              </button>
            ))}
          </div>

          <Label text="샘플러" mt />
          <select className="input-field text-[11px] font-mono">
            <option>dpmpp_2m</option>
            <option>euler</option>
            <option>euler_ancestral</option>
            <option>ddim</option>
          </select>

          <Label text="스케줄러" mt />
          <select className="input-field text-[11px] font-mono">
            <option>karras</option>
            <option>normal</option>
            <option>exponential</option>
            <option>sgm_uniform</option>
          </select>
        </div>
      </Section>
    </aside>
  );
}

/* ── 사이드바 서브 컴포넌트 ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-3 border-b border-edge">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-dim mb-2.5">{title}</h3>
      {children}
    </div>
  );
}

function Label({ text, mt = false }: { text: string; mt?: boolean }) {
  return <label className={`block text-[11px] text-text-sub mb-1 ${mt ? "mt-3" : ""}`}>{text}</label>;
}

function LoraItem({ name, strength }: { name: string; strength: number }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-ground ring-1 ring-edge group">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-mono text-text truncate">{name}</p>
        <input type="range" min={0} max={1} step={0.05} defaultValue={strength} className="w-full mt-1.5" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] font-mono text-accent-bright tabular-nums">{strength}</span>
        <button className="text-text-ghost hover:text-bad transition-colors opacity-0 group-hover:opacity-100">
          <XIcon />
        </button>
      </div>
    </div>
  );
}

function SliderField({ label, value, min, max, step = 1 }: { label: string; value: number; min: number; max: number; step?: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-text-sub">{label}</span>
        <span className="text-[11px] font-mono text-accent-bright tabular-nums">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} defaultValue={value} />
    </div>
  );
}

/* ─────────────────────────────────
   히스토리 바 (하단)
   ───────────────────────────────── */
function HistoryBar() {
  return (
    <div className="shrink-0 h-11 px-4 border-t border-edge flex items-center gap-3 overflow-x-auto">
      <span className="text-[10px] text-text-dim uppercase tracking-wider shrink-0 font-semibold">최근</span>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} className="w-8 h-8 rounded-md shrink-0 shimmer ring-1 ring-edge hover:ring-edge-hover transition-all" title={`히스토리 #${i}`} />
      ))}
      <button className="text-[10px] text-text-dim hover:text-text-sub transition-colors shrink-0 ml-1">
        전체 보기 →
      </button>
    </div>
  );
}

/* ─────────────────────────────────
   아이콘
   ───────────────────────────────── */
function ClockIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>);
}
function GearIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>);
}
function SparkleIcon() {
  return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3l1.912 5.813a2 2 0 001.272 1.278L21 12l-5.816 1.91a2 2 0 00-1.272 1.278L12 21l-1.912-5.813a2 2 0 00-1.272-1.278L3 12l5.816-1.91a2 2 0 001.272-1.278z" /></svg>);
}
function XCircleIcon() {
  return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>);
}
function BoltIcon() {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>);
}
function PlusIcon() {
  return (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
}
function RefreshIcon() {
  return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.3" /></svg>);
}
function XIcon() {
  return (<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}

/* ─────────────────────────────────
   메인 페이지 조합
   ───────────────────────────────── */
export default function Home() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-void">
      <Header />
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* 메인 영역 */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <ImageGrid />
          <PromptDock />
        </main>
        {/* 사이드바 */}
        <SettingsSidebar />
      </div>
      <HistoryBar />
    </div>
  );
}
