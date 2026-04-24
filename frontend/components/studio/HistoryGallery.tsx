/**
 * HistoryGallery — 히스토리 갤러리 (Masonry + 날짜 그룹).
 * 2026-04-24 UX v1 · 2026-04-24 date-sections 유틸 공유 리팩터:
 *  - CSS `columns` 기반 Masonry (새 의존성 없음) — 타일은 원본 이미지 비율대로 가변 높이
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
import type { HistoryItem } from "@/lib/api-client";
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
            borderRadius: 12,
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
                  // CSS columns 기반 Masonry — 의존성 0 으로 구현.
                  // 각 자식은 breakInside: avoid 로 컬럼 경계에서 쪼개지지 않게.
                  columnCount: gridCols,
                  columnGap: 12,
                  marginTop: 10,
                }}
              >
                {s.items.map((it) => {
                  // aspect: 원본 이미지/영상 비율 → Masonry 에서 타일 높이 결정.
                  // width/height 가 0 이거나 유효하지 않으면 1/1 폴백.
                  const aspectVal =
                    it.width > 0 && it.height > 0
                      ? `${it.width}/${it.height}`
                      : "1/1";
                  return (
                    <div
                      key={it.id}
                      style={{
                        // CSS fragmentation — 모던 브라우저 (Chrome/Safari/FF) 모두 breakInside 지원.
                        breakInside: "avoid",
                        marginBottom: 12,
                      }}
                    >
                      <HistoryTile
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
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
