"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";

/**
 * 반응형 정책 (P0-1 · 2026-04-26):
 *   - 최소 지원 viewport: 1024px (노트북부터, 모바일 미지원)
 *   - 1024px = floor (좌패널 400 + 우패널 624 정확 fit)
 *   - >1024px = 우패널 자동 확장 (minmax 1fr)
 *   - <1024px = 미지원 (가로 스크롤 또는 깨짐 — 의도된 제약)
 *
 * 메인 메뉴 (app/page.tsx) 는 별도 breakpoint:
 *   ≥1280: 3열 / 1024-1280: 2열 (globals.css `.ais-menu-grid`)
 */
export const STUDIO_MIN_WIDTH = 1024;
export const STUDIO_GRID_COLUMNS = "400px minmax(624px, 1fr)";
export const STUDIO_LEFT_PANEL_PADDING = "24px 20px";
export const STUDIO_RIGHT_PANEL_PADDING = "24px 32px";
export const STUDIO_PANEL_GAP = 18;

export function StudioPage({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        minWidth: STUDIO_MIN_WIDTH,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StudioWorkspace({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: STUDIO_GRID_COLUMNS,
        minHeight: "calc(100vh - 52px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StudioLeftPanel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        padding: STUDIO_LEFT_PANEL_PADDING,
        borderRight: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        gap: STUDIO_PANEL_GAP,
        background: "var(--bg)",
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/**
 * StudioModeHeader — V5 Aurora 디자인 (Phase 1.5.1 · 2026-05-02)
 *
 * 시안 매칭: eyebrow JetBrains Mono `MODE · GENERATE` + Fraunces italic 26 bilingual
 * `<strong>한글</strong> · English` + 우측 흐름 가이드 링크 (옵션) + 점선 border-bottom.
 *
 * Prop:
 *  - titleKo: 한글 제목 (e.g. "생성")
 *  - titleEn: 영문 제목 (e.g. "Generate")
 *  - eyebrow: 작은 mono 라벨 (e.g. "MODE · GENERATE") — 옵션
 *  - description: 부제 (옵션)
 *  - flowHref / flowLabel: 흐름 가이드 링크 (옵션)
 *
 * 호환 alias (Phase 1.5 진행 중):
 *  - 옛 `title` prop 받으면 titleKo 로 매핑 (영문 토큰 추출 시도 — `Image Generate` → "Generate")
 *
 * inline style 잔여 0 — globals.css `.ais-mode-*` 클래스로 처리.
 */
export function StudioModeHeader({
  titleKo,
  titleEn,
  eyebrow,
  description,
  flowHref,
  flowLabel = "프롬프트 흐름 보기",
  /** @deprecated Phase 1.5 호환 — 새 코드는 titleKo + titleEn 사용 */
  title,
}: {
  titleKo?: string;
  titleEn?: string;
  eyebrow?: string;
  description?: string;
  flowHref?: string;
  flowLabel?: string;
  title?: string;
}) {
  // 옛 title alias → titleKo 폴백 (Phase 1.5 호환 — 호출 site 미전환 케이스 대비)
  const resolvedKo = titleKo ?? title ?? "";
  const resolvedEn = titleEn ?? "";
  return (
    <header className="ais-mode-header">
      <div className="ais-mode-title-row">
        <div>
          {eyebrow && <span className="ais-mode-eyebrow">{eyebrow}</span>}
          <h1 className="ais-mode-title">
            {resolvedEn ? (
              <>
                <strong>{resolvedKo}</strong>
                {" · "}
                {resolvedEn}
              </>
            ) : (
              <strong>{resolvedKo}</strong>
            )}
          </h1>
        </div>
        {flowHref && (
          <Link
            href={flowHref}
            title={flowLabel}
            aria-label={flowLabel}
            className="ais-mode-flow-link"
          >
            <Icon name="grid" size={15} />
          </Link>
        )}
      </div>
      {description && <p className="ais-mode-desc">{description}</p>}
    </header>
  );
}

export function StudioRightPanel({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        padding: STUDIO_RIGHT_PANEL_PADDING,
        display: "flex",
        flexDirection: "column",
        gap: STUDIO_PANEL_GAP,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </section>
  );
}
