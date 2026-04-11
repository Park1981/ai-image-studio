/**
 * 히스토리 바 컴포넌트 (하단)
 * Phase 3에서 구현 예정 - 현재 플레이스홀더
 */

'use client'

export default function HistoryBar() {
  return (
    <div className="shrink-0 h-11 px-4 border-t border-edge flex items-center gap-3 overflow-x-auto">
      <span className="text-[10px] text-text-dim uppercase tracking-wider shrink-0 font-semibold">
        최근
      </span>

      {/* 플레이스홀더 썸네일 (Phase 3에서 실제 데이터 연결) */}
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          className="w-8 h-8 rounded-md shrink-0 shimmer ring-1 ring-edge hover:ring-edge-hover transition-all"
          title={`히스토리 #${i}`}
        />
      ))}

      <button className="text-[10px] text-text-dim hover:text-text-sub transition-colors shrink-0 ml-1">
        전체 보기 →
      </button>
    </div>
  )
}
