/**
 * VisionHistoryList — 최근 Vision 분석 기록 (localStorage).
 * 2026-04-24 · C4 · 2026-04-24 날짜 섹션 그룹핑 통일:
 *  - 썸네일 + 본문(시간·해상도·분석결과 2줄) 카드 구조 유지 (Masonry 는 적용 안 함).
 *  - 일반 히스토리와 같은 "오늘 / 어제 / 이번 주 / 날짜" 섹션 + 접기·펼치기 UX.
 *  - 가장 최신 섹션 1개만 기본 펼침.
 */

"use client";

import { useMemo, useState } from "react";
import { IconBtn } from "@/components/chrome/Chrome";
import Icon from "@/components/ui/Icon";
import ImageTile from "@/components/ui/ImageTile";
import SectionHeader from "@/components/studio/SectionHeader";
import { groupByDate, isClosedSection } from "@/lib/date-sections";
import type { VisionEntry } from "@/stores/useVisionStore";

interface Props {
  entries: VisionEntry[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  /** 그리드 컬럼 수 (2/3/4) */
  gridCols: 2 | 3 | 4;
  /** 그리드 토글 콜백 — 부모가 useState 관리 */
  onCycleGrid: () => void;
  /** localStorage 상한 (2026-04-24 G1: 100) */
  maxEntries: number;
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
  onClear,
  gridCols,
  onCycleGrid,
  maxEntries,
}: Props) {
  // nowMs 는 mount 시점 기준 (React 19 purity: useState lazy init).
  const [nowMs] = useState(() => Date.now());
  const sections = useMemo(() => groupByDate(entries, nowMs), [entries, nowMs]);

  // 섹션 접힘 state — "기본값과 반대로 토글된 key" 집합.
  // 기본 규칙(최신 섹션만 펼침)은 렌더 시 isClosedSection 이 판정.
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
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* 상단 헤더 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 6,
          borderTop: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginTop: 10,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            최근 분석
          </h3>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-4)", letterSpacing: ".04em" }}
          >
            {entries.length} / {maxEntries}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 6,
          }}
        >
          <IconBtn
            icon="grid"
            title={`그리드 (${gridCols} 컬럼 · 클릭으로 변경)`}
            onClick={onCycleGrid}
          />
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") {
                  const ok = window.confirm("모든 분석 기록을 지울까?");
                  if (!ok) return;
                }
                onClear();
              }}
              style={{
                all: "unset",
                cursor: "pointer",
                fontSize: 11,
                color: "var(--ink-4)",
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--line)",
              }}
            >
              모두 지우기
            </button>
          )}
        </div>
      </div>

      {/* 리스트 — 갤러리 스크롤 박스 · 날짜 섹션 그룹핑 */}
      {entries.length === 0 ? (
        <div
          style={{
            padding: "20px 16px",
            background: "var(--surface)",
            border: "1px dashed var(--line-2)",
            borderRadius: "var(--radius)",
            textAlign: "center",
            color: "var(--ink-4)",
            fontSize: 12,
          }}
        >
          아직 분석 기록이 없습니다.
        </div>
      ) : (
        <div
          style={{
            maxHeight: "55vh",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
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
                  <div
                    style={{
                      display: "grid",
                      // Vision 카드는 텍스트 포함 → 균일 그리드가 스캔성 높음 (Masonry 미적용).
                      gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                      gap: 10,
                      marginTop: 10,
                    }}
                  >
                    {s.items.map((e) => (
                      <VisionCard
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
   개별 카드 — 섹션 반복 안에서 재사용
   ───────────────────────────────── */

function VisionCard({
  entry: e,
  onSelect,
  onDelete,
}: {
  entry: VisionEntry;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "var(--shadow-sm)",
        cursor: "pointer",
      }}
      onClick={() => onSelect(e.id)}
      title={e.en.slice(0, 120)}
    >
      {/* 썸네일 */}
      <ImageTile
        seed={e.imageRef || e.id}
        aspect="1/1"
        style={{ borderRadius: 0, borderBottom: "1px solid var(--line)" }}
      />

      {/* 본문 */}
      <div style={{ padding: "8px 10px 10px" }}>
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            letterSpacing: ".03em",
            display: "flex",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <span>{formatTime(e.createdAt)}</span>
          {e.width > 0 && e.height > 0 && (
            <span>
              {e.width}×{e.height}
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 11.5,
            color: "var(--ink-2)",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {e.en || (
            <span style={{ color: "var(--amber-ink)" }}>분석 실패</span>
          )}
        </div>
      </div>

      {/* 삭제 버튼 */}
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          onDelete(e.id);
        }}
        title="이 기록 삭제"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "rgba(0,0,0,.5)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Icon name="x" size={10} />
      </button>
    </div>
  );
}
