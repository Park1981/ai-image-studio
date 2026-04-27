/**
 * HistoryGallery — 히스토리 갤러리 (Masonry + 날짜 그룹).
 * 2026-04-24 UX v1 · 2026-04-24 date-sections 유틸 공유 리팩터.
 * 2026-04-26 가로 흐름 전환: CSS `columns` (세로 우선) → JS column 분배 + flex column (가로 우선).
 *  - height-aware 알고리즘: 각 item 을 "현재 누적 높이가 가장 짧은 컬럼" 에 추가
 *    → 컬럼 간 height 균형 + 진짜 Masonry 효과. 의존성 0.
 *  - 시각 결과: 첫 줄에 가장 최신 N개 (왼→오) 가 늘어섬 → 사용자 직관 매칭.
 *  - 비율 유지 그대로 (각 타일 aspect-ratio 살림).
 *  - 날짜 섹션 그룹핑 + 접기·펼치기 (lib/date-sections 공용 유틸)
 *  - 가장 최신 섹션 1개만 기본 펼침 (오늘 없으면 어제가 자동 펼침)
 *  - /generate, /edit, /video 3 페이지 공용
 *
 * 디자인 의도:
 *  - 균일 정사각 그리드는 비율 다양한 이미지(세로/가로/영상)에 부자연스러운 여백을 만듦.
 *    Masonry 는 여백 없이 원본 비율 유지 → 갤러리 느낌.
 *  - 히스토리 수가 많아져도 섹션 접힘 + "최신 섹션만 펼쳐" 심리적 부담 ↓.
 */

"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { HistoryItem } from "@/lib/api/types";
import { groupByDate, isClosedSection } from "@/lib/date-sections";
import HistoryTile from "./HistoryTile";
import SectionHeader from "./SectionHeader";

interface Props {
  /** 호출부에서 mode 로 이미 필터링된 리스트 */
  items: HistoryItem[];
  gridCols: 2 | 3 | 4;
  selectedId: string | null;

  onTileClick: (it: HistoryItem) => void;
  onTileExpand: (it: HistoryItem) => void;
  /** 있을 때만 hover 바에 [원본으로] 버튼 노출 (주로 edit/video) */
  onUseAsSource?: (it: HistoryItem) => void;
  /** 삭제 성공 후 부모 쪽 후처리 (예: afterId null 로) */
  onAfterDelete?: (it: HistoryItem) => void;

  /** 비어있을 때 보여줄 노드. 문자열이면 기본 점선 카드로 감쌈. */
  emptyMessage?: ReactNode;
}

export default function HistoryGallery({
  items,
  gridCols,
  selectedId,
  onTileClick,
  onTileExpand,
  onUseAsSource,
  onAfterDelete,
  emptyMessage = "아직 기록이 없습니다.",
}: Props) {
  // nowMs 는 컴포넌트 mount 시점 기준. 수 분 단위 오차는 UX 상 문제 없음 (자정 걸칠 때만 stale).
  // React 19 purity 규칙: Date.now() 는 impure → useState 의 lazy initializer 로 감쌈.
  const [nowMs] = useState(() => Date.now());
  const sections = useMemo(() => groupByDate(items, nowMs), [items, nowMs]);

  /**
   * 섹션 접힘 상태 — "사용자가 기본값과 반대로 토글한 섹션의 key" 집합.
   * 기본 규칙(최신 섹션만 펼침)은 렌더 시 date-sections.isClosedSection 이 판정.
   * items 가 나중에 로드되거나 섹션 순서가 바뀌어도 자동 재평가.
   */
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());

  const toggle = (key: string) => {
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (items.length === 0) {
    if (typeof emptyMessage === "string") {
      return (
        <div
          style={{
            padding: "28px 20px",
            background: "var(--surface)",
            border: "1px dashed var(--line-2)",
            borderRadius: "var(--radius)",
            textAlign: "center",
            color: "var(--ink-4)",
            fontSize: 12.5,
          }}
        >
          {emptyMessage}
        </div>
      );
    }
    return <>{emptyMessage}</>;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        // 좁은 우측 패널에서 타일 또는 Masonry 내부가 가로로 넘치지 않게 차단.
        // 세로 스크롤은 호출처 스크롤 박스(overflowY:auto)가 담당.
        overflowX: "hidden",
      }}
    >
      {/* 안내: 본 컴포넌트 하단의 MasonryRow 가 실제 grid 분배를 담당 */}
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
              <MasonryRow
                items={s.items}
                gridCols={gridCols}
                selectedId={selectedId}
                onTileClick={onTileClick}
                onTileExpand={onTileExpand}
                onUseAsSource={onUseAsSource}
                onAfterDelete={onAfterDelete}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────
   MasonryRow — 한 날짜 섹션의 타일들을 가로 흐름 Masonry 로 배치.
   2026-04-26 알고리즘:
     1) 각 item 의 aspect 로 "예상 타일 높이 (단위 길이)" 계산
        (width=1 가정 시 height = 1/aspect)
     2) 각 item 을 "현재 누적 높이가 가장 짧은 컬럼" 에 추가
     3) 결과: 컬럼 간 누적 높이 균형 + 진짜 Masonry wall 효과
   시각 결과: 첫 줄에 가장 최신 N개가 가로로 늘어섬 (사용자 직관).
   ───────────────────────────────────────── */
function MasonryRow({
  items,
  gridCols,
  selectedId,
  onTileClick,
  onTileExpand,
  onUseAsSource,
  onAfterDelete,
}: {
  items: HistoryItem[];
  gridCols: 2 | 3 | 4;
  selectedId: string | null;
  onTileClick: (it: HistoryItem) => void;
  onTileExpand: (it: HistoryItem) => void;
  onUseAsSource?: (it: HistoryItem) => void;
  onAfterDelete?: (it: HistoryItem) => void;
}) {
  // 컬럼 분배 — height-aware greedy: 가장 짧은 컬럼에 다음 item 추가
  const columns = useMemo(() => {
    const cols: HistoryItem[][] = Array.from({ length: gridCols }, () => []);
    const heights = new Array<number>(gridCols).fill(0);
    items.forEach((it) => {
      // aspect = w/h. 타일은 컬럼 width(=1) 기준이라 실제 height 는 1/aspect.
      const aspect =
        it.width > 0 && it.height > 0 ? it.width / it.height : 1;
      const tileUnit = 1 / aspect;
      // 가장 짧은 컬럼 인덱스 찾기 — items 적을 때 O(N×cols) 무리 없음
      let shortest = 0;
      for (let i = 1; i < gridCols; i++) {
        if (heights[i] < heights[shortest]) shortest = i;
      }
      cols[shortest].push(it);
      heights[shortest] += tileUnit;
    });
    return cols;
  }, [items, gridCols]);

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        marginTop: 10,
        alignItems: "flex-start",
      }}
    >
      {columns.map((col, c) => (
        <div
          key={c}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            // 좁은 컬럼에서 타일 내부 텍스트 ellipsis 보장
            minWidth: 0,
          }}
        >
          {col.map((it) => {
            const aspectVal =
              it.width > 0 && it.height > 0
                ? `${it.width}/${it.height}`
                : "1/1";
            return (
              <HistoryTile
                key={it.id}
                item={it}
                aspect={aspectVal}
                selected={selectedId === it.id}
                onClick={() => onTileClick(it)}
                onExpand={() => onTileExpand(it)}
                onUseAsSource={
                  onUseAsSource ? () => onUseAsSource(it) : undefined
                }
                onAfterDelete={
                  onAfterDelete ? () => onAfterDelete(it) : undefined
                }
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
