/**
 * HistoryGallery — 히스토리 갤러리 (Masonry + 날짜 그룹).
 * 2026-04-24 UX v1:
 *  - CSS `columns` 기반 Masonry (새 의존성 없음) — 타일은 원본 이미지 비율대로 가변 높이
 *  - 날짜 섹션 그룹핑 (오늘 / 어제 / 이번 주 / YYYY-MM-DD)
 *  - "오늘" 만 기본 열림, 나머지는 접힘 (사용자 토글은 세션 한정)
 *  - /generate, /edit, /video 3 페이지 공용
 *
 * 디자인 의도:
 *  - 균일 정사각 그리드는 비율 다양한 이미지(세로/가로/영상)에 부자연스러운 여백을 만듦.
 *    Masonry 는 여백 없이 원본 비율 유지 → 갤러리 느낌.
 *  - 히스토리 수가 많아져도 섹션 접힘 + "오늘"만 펼쳐 심리적 부담 ↓.
 */

"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { HistoryItem } from "@/lib/api-client";
import HistoryTile from "./HistoryTile";
import Icon from "@/components/ui/Icon";

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

/* ─────────────────────────────────
   날짜 그룹 유틸
   ───────────────────────────────── */

/** 로컬 자정을 ms 로 반환 (해당 타임스탬프가 속한 날짜의 00:00) */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "이번 주" 의 기준 시작 = 이번 주 월요일 00:00 (KR 기준) */
function startOfThisWeekMonday(nowMs: number): number {
  const today = startOfDay(nowMs);
  const d = new Date(today);
  const dow = d.getDay(); // 0=일, 1=월, …, 6=토
  const daysSinceMonday = (dow + 6) % 7; // 월=0, …, 일=6
  return today - daysSinceMonday * 24 * 60 * 60 * 1000;
}

/** MM월 DD일 (YYYY 는 올해가 아닐 때만 앞에 붙임) */
function formatDateLabel(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const now = new Date(nowMs);
  const sameYear = d.getFullYear() === now.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  return sameYear
    ? `${mm}월 ${dd}일`
    : `${d.getFullYear()}년 ${mm}월 ${dd}일`;
}

type Section = {
  /** 안정 key — 접힘 상태 기억에 사용 */
  key: string;
  /** UI 에 표시할 헤더 라벨 */
  label: string;
  /** 최신순으로 정렬된 아이템 */
  items: HistoryItem[];
};

/**
 * items 를 날짜 그룹으로 분할. 최신 섹션 우선.
 * - today      : 오늘 00:00 이후
 * - yesterday  : 어제 00:00 ~ 오늘 00:00
 * - thisWeek   : 이번 주 월요일 ~ 어제 00:00
 * - {YYYY-MM-DD} : 그 외 개별 날짜
 */
function groupByDate(items: HistoryItem[], nowMs: number): Section[] {
  const todayStart = startOfDay(nowMs);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = startOfThisWeekMonday(nowMs);

  // 최신 → 과거 정렬
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt);

  const today: HistoryItem[] = [];
  const yesterday: HistoryItem[] = [];
  const thisWeek: HistoryItem[] = [];
  const byDate = new Map<string, HistoryItem[]>(); // key=YYYY-MM-DD

  for (const it of sorted) {
    const ms = it.createdAt;
    if (ms >= todayStart) {
      today.push(it);
    } else if (ms >= yesterdayStart) {
      yesterday.push(it);
    } else if (ms >= weekStart) {
      thisWeek.push(it);
    } else {
      const d = new Date(startOfDay(ms));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(it);
    }
  }

  const sections: Section[] = [];
  if (today.length > 0) sections.push({ key: "today", label: "오늘", items: today });
  if (yesterday.length > 0) sections.push({ key: "yesterday", label: "어제", items: yesterday });
  if (thisWeek.length > 0) sections.push({ key: "thisWeek", label: "이번 주", items: thisWeek });
  // byDate 는 Map insertion order = 최신 → 과거 (위 정렬 기준)
  for (const [key, list] of byDate) {
    const label = formatDateLabel(list[0].createdAt, nowMs);
    sections.push({ key, label, items: list });
  }
  return sections;
}

/* ─────────────────────────────────
   메인 컴포넌트
   ───────────────────────────────── */

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
   * 섹션 접힘 상태.
   * 기본 규칙: "가장 최신 섹션(index 0) 1개만 펼침, 나머지는 접힘".
   *   - 오늘 항목이 있으면 오늘 섹션이 index 0 이라 오늘이 열림.
   *   - 오늘이 없으면 어제 / 이번 주 / 최신 날짜 섹션이 대신 열림.
   *   - items 가 나중에 로드돼도(초기엔 sections 빈 배열) 렌더 시마다 기본값이 재계산되므로
   *     경쟁 조건 없음.
   *
   * state 에는 "사용자가 기본값과 반대로 토글한 섹션의 key" 만 저장.
   *   - isOpen = defaultOpen XOR toggled.has(key)
   *   - 사용자 토글 의도는 세션 내 보존, 섹션 순서가 바뀌어도 기본 규칙은 자연스럽게 재평가.
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

  /** 섹션 index·key 로 "접힘 여부" 결정 (기본 첫 섹션 열림 ± 사용자 토글) */
  const isClosedSection = (index: number, key: string): boolean => {
    const defaultOpen = index === 0;
    const userToggled = toggled.has(key);
    // defaultOpen XOR userToggled = 열림 → 닫힘은 그 반대
    return defaultOpen === userToggled;
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
        const isClosed = isClosedSection(i, s.key);
        return (
          <section key={s.key}>
            <SectionHeader
              label={s.label}
              count={s.items.length}
              closed={isClosed}
              onToggle={() => toggle(s.key)}
            />
            {!isClosed && (
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

/* ─────────────────────────────────
   섹션 헤더 (접기/펼치기 토글)
   ───────────────────────────────── */

function SectionHeader({
  label,
  count,
  closed,
  onToggle,
}: {
  label: string;
  count: number;
  closed: boolean;
  onToggle: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 4px",
        borderBottom: "1px solid var(--line)",
        fontSize: 12.5,
        fontWeight: 600,
        color: hov ? "var(--ink)" : "var(--ink-2)",
        transition: "color .15s",
      }}
      title={closed ? "펼치기" : "접기"}
    >
      <span
        style={{
          display: "inline-flex",
          transform: closed ? "rotate(-90deg)" : "rotate(0deg)",
          transition: "transform .18s",
          color: "var(--ink-3)",
        }}
      >
        <Icon name="chevron-down" size={13} />
      </span>
      <span>{label}</span>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          letterSpacing: ".04em",
          fontWeight: 500,
        }}
      >
        {count}
      </span>
    </button>
  );
}
