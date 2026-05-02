/**
 * vision-result/DetailCard — 디테일 슬롯 (6개 · 그리드 카드).
 * 2026-04-27 (C2-P1-2): VisionResultCard 분해 — 페이지에서 추출.
 *
 * 2026-05-02 디자인 V5 Phase 6 격상:
 *  - inline → className `.ais-vision-detail-card` + 자식 `.ais-vd-header / -icon / -label / -body`
 *  - data-muted 분기 (CSS 가 background/border/body 색 자동)
 *  - 아이콘박스 (24×24 var(--bg-2)) + UPPERCASE mono 라벨 (10.5 700 letter-spacing 0.08)
 */

"use client";

import Icon from "@/components/ui/Icon";

export type DetailIcon = "grid" | "scan-eye" | "image" | "film" | "zoom-in" | "search";

interface Props {
  label: string;
  value: string | undefined;
  icon: DetailIcon;
  muted?: boolean;
}

export default function DetailCard({ label, value, icon, muted = false }: Props) {
  const empty = !value || !value.trim();
  return (
    <div
      className="ais-vision-detail-card"
      data-muted={muted ? "true" : "false"}
    >
      <div className="ais-vd-header">
        <span className="ais-vd-icon" aria-hidden>
          <Icon name={icon} size={11} />
        </span>
        <span className="ais-vd-label">{label}</span>
      </div>
      <div className="ais-vd-body">
        {empty ? <span className="ais-vd-empty">(없음)</span> : value}
      </div>
    </div>
  );
}
