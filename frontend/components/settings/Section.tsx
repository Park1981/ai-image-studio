/**
 * Section — SettingsDrawer 의 섹션 공용 wrapper.
 *
 * 2026-05-14 Phase 2 — Editorial Anatomy 채택:
 *   - num · bilingual title · meta · desc 4 슬롯 헤더
 *   - 점선 separator 가 section 사이 가르며 hierarchy 표현
 *
 * Phase 3.2 추출 (refactor doc 2026-04-30 §I2) — 옛 SettingsDrawer.tsx (1466줄) 분할.
 */

import type { ReactNode } from "react";

interface Props {
  /** 한글 타이틀 (필수). */
  title: string;
  /** 영문 부제 — Fraunces italic 으로 렌더. 옵션. */
  titleEn?: string;
  /** 섹션 번호 — "01" "02" 식. 옵션 (미지정 시 박스 X). */
  num?: string;
  /** 우측 meta 텍스트 — JetBrains Mono uppercase. 옵션. */
  meta?: ReactNode;
  /** 설명 — 한 줄 desc. 옵션. */
  desc?: string;
  children: ReactNode;
}

export default function Section({
  title,
  titleEn,
  num,
  meta,
  desc,
  children,
}: Props) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <header className="ais-section-head">
        <div className="ais-section-head-main">
          {num && <span className="ais-section-num">{num}</span>}
          <h3 className="ais-section-title">
            <span className="ais-ko">{title}</span>
            {titleEn && <em>{titleEn}</em>}
          </h3>
        </div>
        {meta && <span className="ais-section-meta">{meta}</span>}
      </header>
      {desc && <p className="ais-section-desc">{desc}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </section>
  );
}
