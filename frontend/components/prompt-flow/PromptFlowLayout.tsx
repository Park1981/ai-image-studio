/**
 * PromptFlowLayout — Prompt Flow 도움말 페이지 통합 레이아웃.
 *
 * 구성:
 *   1) AppHeader (전역 통합 헤더)
 *   2) Hero (메뉴 카드 배경 재사용)
 *   3) 본문: 좌측 sticky TOC + 우측 콘텐츠
 *      - 우측 콘텐츠 = 6단계 카드 + extras (매트릭스/옵션) + keyPoints + CTA
 *   4) 우하단 floating "다이어그램 보기" (옵션)
 *
 * generate 모드만 자체 페이지(외부 링크 카드)를 가짐 — 본 컴포넌트는
 * edit / video 의 단순 step 가이드 페이지 전용.
 */

"use client";

import Link from "next/link";
import AppHeader from "@/components/chrome/AppHeader";
import Icon from "@/components/ui/Icon";
import type { ModeContent, ModeExtra } from "@/lib/prompt-flow-content";

import Hero from "./Hero";
import StepGrid from "./StepGrid";
import StickyTOC, { type TocItem } from "./StickyTOC";

const SECTION_STEPS = "steps";
const SECTION_EXTRAS = "extras";
const SECTION_KEYPOINTS = "key-points";
const SECTION_CTA = "cta";

export default function PromptFlowLayout({ content }: { content: ModeContent }) {
  const tocItems: TocItem[] = [];
  if (content.steps && content.steps.length > 0) {
    tocItems.push({ id: SECTION_STEPS, label: "6단계 흐름" });
  }
  if (content.extras && content.extras.length > 0) {
    tocItems.push({ id: SECTION_EXTRAS, label: "추가 안내" });
  }
  if (content.keyPoints && content.keyPoints.length > 0) {
    tocItems.push({ id: SECTION_KEYPOINTS, label: "핵심 포인트" });
  }
  tocItems.push({ id: SECTION_CTA, label: "바로 시작하기" });

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <AppHeader />

      <main
        style={{
          flex: 1,
          padding: "20px 28px 60px",
          maxWidth: 1280,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* 상단: Hero + 빠른 진입 칩 */}
        <Hero meta={content.meta} mode={content.mode} />

        {/* 본문: TOC + 콘텐츠 (≥1280px 에서만 TOC 노출) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 28,
          }}
          className="ais-prompt-flow-body"
        >
          {/* 좌측 sticky TOC — 1280px 이상에서만 활성 */}
          <div className="ais-prompt-flow-toc-wrap">
            <StickyTOC items={tocItems} />
          </div>

          {/* 우측 본문 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 36,
              minWidth: 0,
            }}
          >
            {/* Section: 6단계 */}
            {content.steps && content.steps.length > 0 && (
              <Section
                id={SECTION_STEPS}
                title="6단계 흐름"
                description="요청이 결과가 되기까지 거치는 단계입니다. 각 카드를 펼쳐 자세한 동작을 확인하실 수 있습니다."
              >
                <StepGrid steps={content.steps} />
              </Section>
            )}

            {/* Section: extras (매트릭스 슬롯 / 영상 옵션 / 참조 역할) */}
            {content.extras && content.extras.length > 0 && (
              <Section
                id={SECTION_EXTRAS}
                title="추가 안내"
                description="모드별로 알아 두시면 도움이 되는 세부 정보입니다."
              >
                <div
                  style={{
                    display: "grid",
                    gap: 18,
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(320px, 1fr))",
                  }}
                >
                  {content.extras.map((extra, i) => (
                    <ExtraBlock key={i} extra={extra} />
                  ))}
                </div>
              </Section>
            )}

            {/* Section: 핵심 포인트 */}
            {content.keyPoints && content.keyPoints.length > 0 && (
              <Section
                id={SECTION_KEYPOINTS}
                title="핵심 포인트"
                description="이 모드에서 꼭 기억해 두시면 좋은 세 가지입니다."
              >
                <div
                  style={{
                    display: "grid",
                    gap: 16,
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(260px, 1fr))",
                  }}
                >
                  {content.keyPoints.map((kp, i) => (
                    <article
                      key={i}
                      style={{
                        padding: "18px 18px 16px",
                        background: "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--radius-card)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        boxShadow: "var(--shadow-sm)",
                      }}
                    >
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: "var(--radius-sm)",
                          background: "var(--accent-soft)",
                          color: "var(--accent-ink)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon name={kp.icon} size={16} />
                      </div>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--ink)",
                          letterSpacing: 0,
                        }}
                      >
                        {kp.title}
                      </h3>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12.5,
                          lineHeight: 1.6,
                          color: "var(--ink-3)",
                          letterSpacing: 0,
                        }}
                      >
                        {kp.body}
                      </p>
                    </article>
                  ))}
                </div>
              </Section>
            )}

            {/* Section: CTA — 바로 시작 */}
            <Section
              id={SECTION_CTA}
              title="바로 시작하기"
              description="흐름을 확인하셨다면 바로 사용해 보실 수 있습니다."
            >
              <Link
                href={content.meta.appPath}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "14px 22px",
                  borderRadius: "var(--radius-full)",
                  background: "var(--ink)",
                  color: "#FFFFFF",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: 0,
                  boxShadow: "var(--shadow-md)",
                  transition: "all .15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--accent-ink)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--ink)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <span>{content.meta.title.replace(" 흐름", "")} 화면으로 이동</span>
                <Icon name="arrow-right" size={16} />
              </Link>
            </Section>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────
   Section — 공통 섹션 헤더 + 본문 래퍼
   ───────────────────────────────────────── */
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        scrollMarginTop: 80,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <h2
          className="display"
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 660,
            color: "var(--ink)",
            letterSpacing: 0,
            lineHeight: 1.15,
            fontVariationSettings: '"opsz" 72, "SOFT" 42, "WONK" 0',
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "var(--ink-3)",
            lineHeight: 1.55,
            letterSpacing: 0,
          }}
        >
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────────────────────────
   ExtraBlock — extras 한 항목 (매트릭스/옵션/참조 역할)
   ───────────────────────────────────────── */
function ExtraBlock({ extra }: { extra: ModeExtra }) {
  return (
    <article
      style={{
        padding: "18px 20px 18px",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 700,
          color: "var(--ink)",
          letterSpacing: 0,
        }}
      >
        {extra.title}
      </h3>
      {extra.body && (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: "var(--ink-3)",
            lineHeight: 1.55,
            letterSpacing: 0,
          }}
        >
          {extra.body}
        </p>
      )}
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {extra.items.map((item, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "9px 12px",
              background: "var(--bg-2)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                fontSize: 11.5,
                fontWeight: 800,
                color: "var(--ink)",
                letterSpacing: 0,
                lineHeight: 1.5,
                minWidth: 60,
              }}
            >
              {item.label}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                lineHeight: 1.55,
                letterSpacing: 0,
              }}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
