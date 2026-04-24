/**
 * date-sections — 히스토리 항목을 날짜 기반 섹션으로 그룹핑하는 공용 유틸.
 *
 * 2026-04-24 · 비전 히스토리에도 "오늘 / 어제 / 이번 주 / YYYY-MM-DD" 섹션 UX 를
 *  통일하면서 HistoryGallery(HistoryItem) 와 VisionHistoryList(VisionEntry) 가
 *  공유하도록 제네릭으로 추출.
 *
 * 섹션 순서 (최신 → 과거):
 *   today      : 오늘 00:00 이후
 *   yesterday  : 어제 00:00 ~ 오늘 00:00
 *   thisWeek   : 이번 주 월요일 00:00 ~ 어제 00:00
 *   {YYYY-MM-DD} : 그 외 개별 날짜
 */

export type Section<T> = {
  /** 안정 key — 접힘 상태 기억 등에 사용 */
  key: string;
  /** UI 에 표시할 헤더 라벨 */
  label: string;
  /** 최신순으로 정렬된 아이템 */
  items: T[];
};

/** 로컬 자정 ms (해당 타임스탬프가 속한 날짜의 00:00) */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 이번 주 월요일 00:00 ms (KR 주 시작 = 월요일) */
export function startOfThisWeekMonday(nowMs: number): number {
  const today = startOfDay(nowMs);
  const d = new Date(today);
  const dow = d.getDay(); // 0=일, 1=월, …, 6=토
  const daysSinceMonday = (dow + 6) % 7; // 월=0, …, 일=6
  return today - daysSinceMonday * 24 * 60 * 60 * 1000;
}

/** M월 D일 (타 연도는 앞에 YYYY) */
export function formatDateLabel(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const now = new Date(nowMs);
  const sameYear = d.getFullYear() === now.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  return sameYear
    ? `${mm}월 ${dd}일`
    : `${d.getFullYear()}년 ${mm}월 ${dd}일`;
}

/**
 * items 를 날짜 섹션으로 그룹핑. 최신 섹션이 앞쪽에 옴.
 * T 는 createdAt(unix ms) 만 있으면 어느 타입이든 가능 (HistoryItem, VisionEntry …).
 */
export function groupByDate<T extends { createdAt: number }>(
  items: T[],
  nowMs: number,
): Section<T>[] {
  const todayStart = startOfDay(nowMs);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = startOfThisWeekMonday(nowMs);

  // 최신 → 과거
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt);

  const today: T[] = [];
  const yesterday: T[] = [];
  const thisWeek: T[] = [];
  const byDate = new Map<string, T[]>(); // key=YYYY-MM-DD

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

  const sections: Section<T>[] = [];
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

/**
 * 섹션 접힘 상태 판정.
 * 기본 규칙: "가장 최신 섹션(index 0) 1개만 펼침, 나머지는 접힘".
 * 사용자 토글은 "기본값과 반대로 설정된 key" 집합으로 관리 → XOR 로 최종 상태 계산.
 *
 * @param index 섹션의 현재 배열 index (0 = 최신)
 * @param key   섹션 key
 * @param toggledKeys 사용자가 기본값 반대로 토글한 key 집합
 * @returns true 면 접힘, false 면 펼침
 */
export function isClosedSection(
  index: number,
  key: string,
  toggledKeys: ReadonlySet<string>,
): boolean {
  const defaultOpen = index === 0;
  const userToggled = toggledKeys.has(key);
  // defaultOpen XOR userToggled = 열림 → 닫힘은 그 반대
  return defaultOpen === userToggled;
}
