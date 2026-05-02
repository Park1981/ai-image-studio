/**
 * HistorySectionHeader — 히스토리 섹션 통합 "Archive Header".
 * 2026-04-24 · 4 메뉴 (generate / edit / video / vision) 통일.
 *
 * 2026-05-02 디자인 V5 Phase 4 격상 (결정 Q):
 *  - 옛 작은 헤더 (border-top + h3 13px) → **Archive Header** 시그니처
 *  - 점선 border-top + eyebrow `IMAGE STUDIO · ARCHIVE` (mono UPPERCASE) +
 *    Fraunces italic 26 bilingual `<strong>한글</strong> · English` + count + size chip
 *  - className `.ais-archive-header` (V5 토큰 cascade)
 *  - 신규 옵셔널 props: titleEn, sizeBytes
 *  - 기존 호출처 호환 — titleEn/sizeBytes 안 넘기면 한글만 + size chip 미노출
 */

"use client";

import type { ReactNode } from "react";

interface Props {
  /** 한글 타이틀 — Fraunces italic `<strong>` 으로 강조 */
  title: string;
  /** 영문 타이틀 (옵셔널) — bilingual 시그니처 */
  titleEn?: string;
  /** 항목 갯수 — count chip 으로 표시 */
  count: number;
  /** count chip 단위 (기본 "items" · 시안 톤 — 영문/숫자 mono) */
  countLabel?: string;
  /** 디스크 사용량 (bytes) — 있으면 size chip 추가 노출. 없으면 size chip 미노출. */
  sizeBytes?: number;
  /** 우측 액션 슬롯 (옵셔널 · 현재 호출처는 미사용) */
  actions?: ReactNode;
}

/** bytes → 사람 읽기 쉬운 단위 (KB / MB / GB · 시안 톤). */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  // MB 이상은 정수, KB 미만은 정수, KB 는 소수 1자리
  const formatted = i >= 2 ? Math.round(value).toString() : i === 1 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${units[i]}`;
}

export default function HistorySectionHeader({
  title,
  titleEn,
  count,
  countLabel = "items",
  sizeBytes,
  actions,
}: Props) {
  const hasSizeChip = typeof sizeBytes === "number" && sizeBytes > 0;
  return (
    <div className="ais-archive-header">
      <div className="ais-archive-eyebrow">IMAGE STUDIO · ARCHIVE</div>
      <div className="ais-archive-title-row">
        <h2 className="ais-archive-title">
          <strong>{title}</strong>
          {titleEn ? ` · ${titleEn}` : null}
        </h2>
        <div className="ais-archive-meta-pills">
          <span className="ais-archive-pill mono">
            {count} {countLabel}
          </span>
          {hasSizeChip && (
            <span className="ais-archive-pill ais-pill-size mono">
              {formatBytes(sizeBytes!)}
            </span>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
