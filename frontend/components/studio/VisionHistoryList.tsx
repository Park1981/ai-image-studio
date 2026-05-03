/**
 * VisionHistoryList — 최근 Vision 분석 기록 (localStorage).
 * 2026-04-24 · C4 · 2026-04-24 날짜 섹션 그룹핑 통일.
 *
 * 2026-05-02 디자인 V5 Phase 6 격상:
 *  - 옛 ImageTile + label 패턴 폐기 → 새 vision-history-tile (썸네일 88 + 본문 mono meta + Fraunces italic summary 2-line)
 *  - 2-col 고정 grid (`.ais-vision-history-grid`) — 옛 gridCols 2/3/4 토글 props 제거
 *  - className `.ais-vision-history-tile` + `.ais-vht-thumb / -body / -meta / -summary`
 *  - 삭제 버튼은 옛 hover absolute X 패턴 유지 (시안 명시 X 지만 production UX 보존)
 *  - 날짜 섹션 그룹핑 (groupByDate + SectionHeader Phase 4 V5 Fraunces italic) 그대로
 */

"use client";

import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import SectionHeader from "@/components/studio/SectionHeader";
import { groupByDate, isClosedSection } from "@/lib/date-sections";
import type { VisionEntry } from "@/stores/useVisionStore";

interface Props {
  entries: VisionEntry[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}`;
}

export default function VisionHistoryList({
  entries,
  onSelect,
  onDelete,
}: Props) {
  // nowMs 는 mount 시점 기준 (React 19 purity: useState lazy init).
  const [nowMs] = useState(() => Date.now());
  const sections = useMemo(() => groupByDate(entries, nowMs), [entries, nowMs]);

  // 섹션 접힘 state — "기본값과 반대로 토글된 key" 집합.
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => {
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="ais-vision-history">
      {/* 2026-05-03: 옛 자체 헤더 (.ais-vision-history-header) 제거.
       *  HistorySectionHeader (Archive Header) 가 페이지 레벨에서 통일 — Edit/Generate 패턴.
       *  "모두 지우기" 는 페이지의 actions 슬롯으로, count "/ 100" 은 countLabel 로 이전. */}
      {entries.length === 0 ? (
        <div className="ais-vision-history-empty">아직 분석 기록이 없습니다.</div>
      ) : (
        <div className="ais-vision-history-scroll">
          {sections.map((s, i) => {
            const closed = isClosedSection(i, s.key, toggled);
            return (
              <section key={s.key}>
                <SectionHeader
                  label={s.label}
                  count={s.items.length}
                  closed={closed}
                  onToggle={() => toggle(s.key)}
                />
                {!closed && (
                  <div className="ais-vision-history-grid">
                    {s.items.map((e) => (
                      <VisionHistoryTile
                        key={e.id}
                        entry={e}
                        onSelect={onSelect}
                        onDelete={onDelete}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────
   개별 타일 — V5 vision-history-tile 패턴
   썸네일 88 + 본문 (mono meta + Fraunces italic summary 2-line truncate)
   ───────────────────────────────── */

function VisionHistoryTile({
  entry: e,
  onSelect,
  onDelete,
}: {
  entry: VisionEntry;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const dim = e.width > 0 && e.height > 0 ? `${e.width} × ${e.height}` : "";
  const metaText = dim ? `${formatTime(e.createdAt)} · ${dim}` : formatTime(e.createdAt);

  return (
    <div
      className="ais-vision-history-tile"
      onClick={() => onSelect(e.id)}
      title={e.en.slice(0, 120)}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect(e.id);
        }
      }}
    >
      <div className="ais-vht-thumb">
        {e.imageRef ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.imageRef} alt="" />
        ) : null}
      </div>
      <div className="ais-vht-body">
        <div className="ais-vht-meta">{metaText}</div>
        {e.en ? (
          <p className="ais-vht-summary">{e.en}</p>
        ) : (
          <p className="ais-vht-summary ais-vht-summary-failed">분석 실패</p>
        )}
      </div>
      <button
        type="button"
        className="ais-vht-delete"
        title="이 기록 삭제"
        aria-label="기록 삭제"
        onClick={(ev) => {
          ev.stopPropagation();
          onDelete(e.id);
        }}
      >
        <Icon name="x" size={10} />
      </button>
    </div>
  );
}
