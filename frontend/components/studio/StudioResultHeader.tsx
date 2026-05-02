/**
 * StudioResultHeader — 4 페이지 우측 결과 영역 상단 헤더 공통화 (audit R2-1).
 *
 * 2026-04-27: accent vertical bar 추가 (오빠 피드백 — 텍스트 앞 시각 마커).
 *  카테고리 색상 코딩: input=blue · output=violet · archive=neutral
 *
 * 2026-05-02 디자인 V5 Phase 4 격상:
 *  - inline style → className `.ais-result-header` 전환
 *  - eyebrow `IMAGE STUDIO · {EYEBROW}` (mono UPPERCASE) + Fraunces italic 26 bilingual title + meta pills
 *  - violet output accent (`#7C3AED`) — `<strong>` CSS 가 자동 처리
 *  - SectionAccentBar 는 옛 좌측 패널 호환을 위해 export 만 유지 (격상된 헤더 본문에서는 미사용)
 */

"use client";

import type { ReactNode } from "react";

export type SectionAccent = "blue" | "violet" | "neutral";

const ACCENT_COLOR: Record<SectionAccent, string> = {
  blue: "var(--accent)", // 입력 (프롬프트)
  violet: "#A78BFA", // 출력 (생성/수정 결과 · 1차 시안 인라인 · OK 시 토큰화)
  neutral: "var(--line-2)", // 보관 (히스토리)
};

/**
 * 섹션 제목 좌측 vertical color bar — 3×14px · 둥근 모서리.
 * V5 격상 후 StudioResultHeader 본문에선 미사용. 좌측 패널 (Generate/Edit/Video/Compare LeftPanel) 호환용 export.
 */
export function SectionAccentBar({ accent }: { accent: SectionAccent }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 3,
        height: 14,
        borderRadius: 2,
        background: ACCENT_COLOR[accent],
        flexShrink: 0,
        // baseline 정렬 보정 — h3 의 descender 와 맞춤
        transform: "translateY(2px)",
      }}
    />
  );
}

interface Props {
  /** 한글 타이틀 — Fraunces italic 본문에서 violet `<strong>` 으로 강조 */
  title: string;
  /** 영문 타이틀 (옵셔널) — bilingual 시그니처. 없으면 한글만 표시. */
  titleEn?: string;
  /** Eyebrow 라벨 (mono UPPERCASE · 기본 "RESULT" — 시안 톤). 페이지별 분기 시 호출처에서 명시. */
  eyebrow?: string;
  /** 우측 meta — string 또는 ReactNode (pill 그룹 직접 넘기면 자유). string 이면 단일 pill 로 wrapping */
  meta?: ReactNode;
  /** 우측 meta 뒤 액션 슬롯 (SmallBtn, IconBtn 등) */
  actions?: ReactNode;
  /** @deprecated V5 격상 후 본문 미사용. 좌측 패널 SectionAccentBar export 호환용으로만 유지. */
  accent?: SectionAccent;
}

export default function StudioResultHeader({
  title,
  titleEn,
  eyebrow = "RESULT",
  meta,
  actions,
}: Props) {
  return (
    <div className="ais-result-header">
      <div className="ais-result-eyebrow">IMAGE STUDIO · {eyebrow}</div>
      <div className="ais-result-title-row">
        <h2 className="ais-result-title">
          <strong>{title}</strong>
          {titleEn ? ` · ${titleEn}` : null}
        </h2>
        {(meta != null || actions) && (
          <div className="ais-result-meta-pills">
            {typeof meta === "string" ? (
              <span className="ais-result-pill">{meta}</span>
            ) : (
              meta
            )}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
