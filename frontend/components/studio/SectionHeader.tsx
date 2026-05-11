/**
 * SectionHeader — 날짜 섹션 접기·펼치기 헤더.
 * 2026-04-24 · HistoryGallery / VisionHistoryList 공용.
 *
 * 클릭 시 토글, ▼/▶ 화살표 회전, 라벨 옆에 개수 chip 노출.
 *
 * 2026-05-02 디자인 V5 Phase 4 격상:
 *  - inline style → className `.ais-history-section-header` 전환 (V5 토큰 cascade)
 *  - Fraunces italic bilingual `<strong>오늘</strong> · Today` 17px (알려진 한글 → 영문 매핑 내장)
 *  - chevron + count chip CSS 가 처리 (data-closed 속성 분기)
 *  - 박스 카드 형태 (border + radius + surface + shadow) — 닫힘/열림 동일 (옵션 A 유지)
 *  - 닫힘 = ink-3 / 열림 = ink → 위계 표현
 */

"use client";

import Icon from "@/components/ui/Icon";

interface Props {
  label: string;
  count: number;
  closed: boolean;
  onToggle: () => void;
}

/**
 * 알려진 한글 라벨 → 영문 단독 표시.
 * 동적 날짜 ("5월 1일" 등) 는 아래 numeric label 로 변환한다.
 */
const KNOWN_EN: Record<string, string> = {
  "오늘": "Today",
  "어제": "Yesterday",
  "이번 주": "This week",
};

function toNumericDateLabel(label: string): string {
  const full = label.match(/^(\d{4})년\s+(\d{1,2})월\s+(\d{1,2})일$/);
  if (full) {
    return `${full[1]}.${full[2].padStart(2, "0")}.${full[3].padStart(2, "0")}`;
  }
  const short = label.match(/^(\d{1,2})월\s+(\d{1,2})일$/);
  if (short) {
    return `${short[1].padStart(2, "0")}.${short[2].padStart(2, "0")}`;
  }
  return label;
}

export default function SectionHeader({ label, count, closed, onToggle }: Props) {
  const labelEn = KNOWN_EN[label];
  const displayLabel = labelEn ?? toNumericDateLabel(label);
  return (
    <button
      type="button"
      className="ais-history-section-header"
      data-closed={closed ? "true" : "false"}
      onClick={onToggle}
      title={closed ? "펼치기" : "접기"}
    >
      <span aria-hidden className="ais-chev">
        <Icon name="chevron-down" size={14} />
      </span>
      <span className="ais-title">
        <strong>{displayLabel}</strong>
      </span>
      <span className="ais-count mono">{count}</span>
    </button>
  );
}
