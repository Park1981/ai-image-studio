/**
 * StudioResultHeader — 4 페이지 우측 결과 영역 상단 헤더 공통화 (audit R2-1).
 *
 * 기존: generate/edit/video/vision/compare 가 모두 동일 인라인 패턴
 *   `<div flex baseline justify-between>h3 + mono meta</div>` 를 직접 적고 있음.
 *   → 신규 기능 추가 시 다시 불일치 생길 위험 → 공통화.
 *
 * 사용 예:
 *   <StudioResultHeader title="생성 결과" meta="1024×1024" />
 *   <StudioResultHeader title="영상 결과" meta="MP4 · 5s · 25fps" actions={<SmallBtn ... />} />
 */

"use client";

import type { ReactNode } from "react";

export default function StudioResultHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  /** 우측 mono meta 뒤에 붙는 선택적 액션 슬롯 (SmallBtn, IconBtn 등) */
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {title}
      </h3>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        {meta != null && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
            }}
          >
            {meta}
          </span>
        )}
        {actions}
      </div>
    </div>
  );
}
