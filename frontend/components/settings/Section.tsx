/**
 * Section — SettingsDrawer 의 섹션 공용 wrapper.
 *
 * 2026-05-14 Phase 2 — Editorial Anatomy 채택:
 *   - num · bilingual title · meta · desc 4 슬롯 헤더
 *   - 첫 섹션 (first=true) 위쪽 padding 0 / 나머지 padding-top 22
 *   - 첫 섹션 외 위쪽에 점선 separator (Turbopack hot reload 안정성 위해
 *     CSS pseudo 대신 인라인 absolute span 사용)
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
  /** 첫 섹션 — 위쪽 separator + padding 제거. 기본 false. */
  first?: boolean;
  children: ReactNode;
}

export default function Section({
  title,
  titleEn,
  num,
  meta,
  desc,
  first = false,
  children,
}: Props) {
  return (
    <section
      className="ais-settings-section"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        // marginTop 으로 이전 섹션 끝과 separator 사이 호흡 확보
        // (separator 는 paddingTop 영역의 top:0 에 위치 → marginTop 만큼 위 여백).
        marginTop: first ? 0 : 14,
        paddingTop: first ? 0 : 22,
      }}
    >
      {!first && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            backgroundImage:
              "repeating-linear-gradient(90deg, var(--line-2) 0 4px, transparent 4px 8px)",
          }}
        />
      )}
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
