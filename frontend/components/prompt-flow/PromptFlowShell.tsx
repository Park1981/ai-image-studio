/**
 * PromptFlowShell — 도움말 페이지 풀 레이아웃.
 *
 * 옛 page.tsx 의 mode 별 섹션 레이아웃을 단일 mode 페이지 형태로 재구성.
 * 구조:
 *   1) AppHeader
 *   2) Hero (Prompt Flow Guide kicker + h1 + subtitle + 3 mode 칩)
 *   3) Journey 5단계 공통 안내
 *   4) DiagramSlot (mode 별 — generate 만 실 다이어그램, edit/video placeholder)
 *   5) Mode 흐름 섹션 (timeline 단계 + 사이드 ruleBlock + 모드 비주얼 카드)
 *   6) (edit 전용) 매트릭스 슬롯 + 참조 이미지 역할
 *   7) Example Flow (4 카드)
 *   8) CTA — 모드 화면으로 이동
 */

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import AppHeader from "@/components/chrome/AppHeader";
import Icon from "@/components/ui/Icon";
import { StudioPage } from "@/components/studio/StudioLayout";
import {
  journey,
  type FlowMode,
  type ModeContent,
} from "@/lib/prompt-flow-content";

import StepCard from "./StepCard";
import DiagramSlot from "./DiagramSlot";
import styles from "./prompt-flow.module.css";

export default function PromptFlowShell({
  content,
  diagram,
}: {
  content: ModeContent;
  /** mode 별 다이어그램 컴포넌트 — 없으면 placeholder. */
  diagram?: ReactNode;
}) {
  const otherModes: FlowMode[] = (
    ["generate", "edit", "video"] as FlowMode[]
  ).filter((m) => m !== content.mode);

  const scrollToTop = () => {
    document.getElementById("top")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <StudioPage>
      <AppHeader />
      <main id="top" className={styles.page}>
        {/* ───── Hero (메인 카드 톤 — 배경이미지 + 그라디언트 + 텍스트 + 작은 mode 칩) ───── */}
        <section
          aria-labelledby="prompt-flow-hero-title"
          style={{
            position: "relative",
            width: "100%",
            minHeight: 360,
            borderRadius: "var(--radius-xl)",
            overflow: "hidden",
            background: "#0c0c10",
            boxShadow: "var(--shadow-md)",
          }}
        >
          {/* 배경 이미지 — 메뉴 카드와 동일 자산 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={content.meta.modeImage}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "brightness(0.72) saturate(1.04)",
            }}
          />
          {/* 좌→우 어둡게 그라디언트 (텍스트 가독성) */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(105deg, rgba(10,12,16,.78) 0%, rgba(10,12,16,.55) 48%, rgba(10,12,16,.18) 100%)",
              pointerEvents: "none",
            }}
          />

          {/* 텍스트 + 작은 mode 칩 */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              padding: "44px 40px 32px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              minHeight: 360,
              justifyContent: "flex-end",
              color: "#FFFFFF",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignSelf: "flex-start",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: ".22em",
                color: "rgba(255,255,255,.86)",
                textTransform: "uppercase",
              }}
            >
              Prompt Flow Guide · {content.meta.eyebrow}
            </div>

            <h1
              id="prompt-flow-hero-title"
              className="display"
              style={{
                margin: 0,
                fontSize: 38,
                fontWeight: 660,
                lineHeight: 1.08,
                letterSpacing: "-0.01em",
                color: "#FFFFFF",
                fontVariationSettings: '"opsz" 72, "SOFT" 42, "WONK" 0',
              }}
            >
              {content.meta.title}
            </h1>

            <p
              style={{
                margin: 0,
                maxWidth: 720,
                fontSize: 14,
                lineHeight: 1.55,
                color: "rgba(255,255,255,.86)",
                fontWeight: 500,
              }}
            >
              {content.meta.subtitle}
            </p>

            {/* 다른 mode 도움말 진입점 — 작은 칩 */}
            <nav
              aria-label="다른 모드 도움말 빠른 이동"
              style={{
                marginTop: 10,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {otherModes.map((m) => (
                <Link
                  key={m}
                  href={`/prompt-flow/${m}`}
                  title={`${modeLabel(m)} 도움말로 이동`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 13px",
                    borderRadius: "var(--radius-full)",
                    background: "rgba(255,255,255,.16)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,.32)",
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 0,
                    textDecoration: "none",
                    transition: "all .15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.26)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,.16)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <Icon name={modeIconName(m)} size={13} />
                  {modeLabel(m)} 도움말
                </Link>
              ))}
            </nav>
          </div>
        </section>

        {/* ───── Journey (공통 5단계) ───── */}
        <section className={styles.overview} aria-labelledby="overview-title">
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>한 줄 요약</span>
            <h2 id="overview-title">세 흐름은 같은 원리로 움직입니다</h2>
            <p>
              사용자가 입력하신 문장이 바로 엔진으로 전달되는 것이 아니라,
              목적에 맞게 정리되고 필요한 컨텍스트(해상도·이미지·스타일 등)가
              결합된 뒤 최종 프롬프트로 넘어갑니다.
            </p>
          </div>
          <div className={styles.journey}>
            {journey.map((step, idx) => (
              <div className={styles.journeyStep} key={step.title}>
                <div className={styles.journeyIcon}>
                  <Icon name={step.icon} size={18} />
                </div>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
                {idx < journey.length - 1 && (
                  <div className={styles.journeyArrow} aria-hidden="true">
                    <Icon name="arrow-right" size={18} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ───── 다이어그램 (mode 별) ───── */}
        <DiagramSlot mode={content.mode}>{diagram}</DiagramSlot>

        {/* ───── Mode 흐름 섹션 (timeline + aside) ───── */}
        <section
          id={content.meta.anchorId}
          className={styles.modeDetail}
          aria-labelledby={`${content.mode}-title`}
        >
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>{content.meta.eyebrow}</span>
            <h2 id={`${content.mode}-title`}>{content.meta.title}</h2>
            <p>{content.meta.subtitle}</p>
          </div>

          <div className={styles.modeDetailGrid}>
            <div className={styles.timeline}>
              {content.steps.map((step) => (
                <StepCard step={step} key={step.index} />
              ))}
            </div>

            <aside
              className={styles.modeAside}
              aria-label={`${modeLabel(content.mode)} 사이드 안내`}
            >
              <article className={styles.visualModeCard}>
                <div
                  className={styles.summaryMedia}
                  style={{
                    backgroundImage: `linear-gradient(90deg, rgba(31,31,31,.58), rgba(31,31,31,.16)), url(${content.meta.modeImage})`,
                  }}
                >
                  <Icon name={content.meta.modeIcon} size={24} />
                  <h3>{modeLabel(content.mode)}</h3>
                </div>
              </article>

              {content.ruleBlocks.map((rb) => (
                <div key={rb.title} className={styles.ruleBlock}>
                  <h3>{rb.title}</h3>
                  <p>{rb.body}</p>
                </div>
              ))}

              {/* edit 전용: 매트릭스 슬롯 */}
              {content.matrixSlots && (
                <div className={styles.ruleBlock}>
                  <h3>분석표 슬롯 구성</h3>
                  <p>이미지 도메인에 따라 다음 슬롯으로 분석합니다.</p>
                  <div className={styles.slotColumns}>
                    <div className={styles.slotList}>
                      <strong>인물 사진</strong>
                      {content.matrixSlots.preserve.map((it) => (
                        <span key={it}>{it}</span>
                      ))}
                    </div>
                    <div className={styles.slotList}>
                      <strong>물체·풍경</strong>
                      {content.matrixSlots.scene.map((it) => (
                        <span key={it}>{it}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* edit 전용: 참조 이미지 역할 */}
              {content.referenceRules && content.referenceRules.length > 0 && (
                <div className={styles.ruleBlock}>
                  <h3>참조 이미지가 있을 때</h3>
                  <div className={styles.referenceRows}>
                    {content.referenceRules.map((rr) => (
                      <div key={rr.label} className={styles.referenceRule}>
                        <span>{rr.label}</span>
                        <p>{rr.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>

        {/* ───── Example Flow ───── */}
        <section className={styles.example} aria-labelledby="example-title">
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>예시</span>
            <h2 id="example-title">프롬프트가 실제로 변하는 느낌</h2>
          </div>
          <div className={styles.exampleFlow}>
            {content.examples.map((ex) => (
              <article key={ex.label} className={styles.exampleCard}>
                <span>{ex.label}</span>
                <p>{ex.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ───── CTA — 모드 화면으로 이동 ───── */}
        <section className={styles.example}>
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
            <Icon name={content.meta.modeIcon} size={16} />
            <span>{modeLabel(content.mode)} 화면으로 이동</span>
            <Icon name="arrow-right" size={14} />
          </Link>
        </section>

        {/* ───── 맨 위로 ───── */}
        <button
          type="button"
          className={styles.topButton}
          onClick={scrollToTop}
          title="맨 위로"
          aria-label="맨 위로 이동"
        >
          <Icon name="chevron-down" size={18} />
          TOP
        </button>
      </main>
    </StudioPage>
  );
}

function modeLabel(m: FlowMode): string {
  return m === "generate" ? "이미지 생성" : m === "edit" ? "이미지 수정" : "영상 생성";
}

function modeIconName(m: FlowMode) {
  return m === "generate" ? "image" : m === "edit" ? "edit" : "play";
}
