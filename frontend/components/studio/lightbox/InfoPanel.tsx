/**
 * lightbox/InfoPanel — Lightbox 우측 정보 패널 (메타 + 프롬프트 + 비전 + 비교 분석).
 * 2026-04-27 (C2-P1-2): ImageLightbox 분해 — main 파일에서 추출.
 *
 * 구성 (위→아래):
 *   - 헤더 (item.label)
 *   - 원본 프롬프트 / 업그레이드 EN / 한글 번역
 *   - 비전 분석 (editVisionAnalysis 또는 옛 visionDescription 폴백)
 *   - Claude 개선 힌트
 *   - ComfyUI 오류 (Mock 폴백 시)
 *   - 비교 분석 (Edit + comparisonAnalysis 있을 때)
 *   - Meta (모델/사이즈/seed/cfg/duration/fps/...)
 *
 * 외부 의존성: HistoryItem 타입 + copyText util + 3 sibling 컴포넌트 + 1 hook.
 */

"use client";

import { useState } from "react";
import ComparisonAnalysisCard from "@/components/studio/ComparisonAnalysisCard";
import ComparisonAnalysisModal from "@/components/studio/ComparisonAnalysisModal";
import EditVisionBlock from "@/components/studio/EditVisionBlock";
import Icon from "@/components/ui/Icon";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";
import { copyText } from "@/lib/image-actions";
import type { HistoryItem } from "@/lib/api/types";

export const INFO_PANEL_WIDTH = 340;

interface Props {
  item: HistoryItem;
  onClose: (e: React.MouseEvent) => void;
}

export default function InfoPanel({ item, onClose }: Props) {
  return (
    <aside
      // 2026-04-30 (오빠 후속 피드백): 텍스트 드래그 + 부분 복사 활성화.
      //   - 옛 onClick={onClose} 는 짧은 드래그 = click 으로 간주돼 selection 도중 모달이 닫혔음.
      //   - currentTarget 가드 → 자식 (텍스트 영역 등) click 은 무시, aside 자체 빈 영역만 onClose.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(e);
      }}
      // 패널 내 휠 이벤트는 상위 overlay 의 zoom 핸들러로 전파되지 않도록 차단 —
      // 패널 자체 overflowY:auto 가 정상 스크롤 담당.
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: INFO_PANEL_WIDTH,
        background: "rgba(16,16,20,.96)",
        borderLeft: "1px solid rgba(255,255,255,.08)",
        overflowY: "auto",
        padding: "60px 20px 28px",
        color: "rgba(255,255,255,.92)",
        zIndex: 3,
        boxShadow: "-8px 0 24px rgba(0,0,0,.4)",
        // LightboxInner 부모의 userSelect:none 을 덮어써서 InfoPanel 안 텍스트는 선택 가능.
        userSelect: "text",
        WebkitUserSelect: "text",
      }}
    >
      {/* 헤더 — 프롬프트 28자 요약 (상단 타이틀) */}
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          {item.label}
        </div>
      </div>

      {/* 원본 프롬프트 */}
      <section style={{ marginBottom: 18 }}>
        <SectionTitle
          action={<CopyChip text={item.prompt} label="원본 프롬프트" />}
        >
          원본 프롬프트
        </SectionTitle>
        <PromptBlock text={item.prompt} />
      </section>

      {/* 업그레이드된 영문 — 있으면 */}
      {item.upgradedPrompt && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle
            action={
              <CopyChip text={item.upgradedPrompt} label="업그레이드 (영문)" />
            }
          >
            업그레이드 <span style={{ color: "rgba(255,255,255,.45)" }}>EN</span>
          </SectionTitle>
          <PromptBlock text={item.upgradedPrompt} />
        </section>
      )}

      {/* 한글 번역 — 있으면 */}
      {item.upgradedPromptKo && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle
            action={
              <CopyChip text={item.upgradedPromptKo} label="한글 번역" />
            }
          >
            한글 번역 <span style={{ color: "rgba(255,255,255,.45)" }}>KO</span>
          </SectionTitle>
          <PromptBlock text={item.upgradedPromptKo} />
        </section>
      )}

      {/* 비전 설명 / 구조 분석 (Edit 모드) —
           Phase 1 (2026-04-25): editVisionAnalysis 있으면 칩 UI,
           없으면 기존 visionDescription 단락 폴백 (옛 히스토리 호환). */}
      {item.editVisionAnalysis ? (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle>비전 모델 분석</SectionTitle>
          <EditVisionBlock
            analysis={item.editVisionAnalysis}
            showHeader={false}
          />
        </section>
      ) : item.visionDescription ? (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle
            action={
              <CopyChip text={item.visionDescription} label="비전 설명" />
            }
          >
            비전 설명
          </SectionTitle>
          <PromptBlock text={item.visionDescription} />
        </section>
      ) : null}

      {/* Claude 개선 힌트 */}
      {item.researchHints && item.researchHints.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle>Claude 개선 힌트</SectionTitle>
          <ul
            style={{
              listStyle: "disc",
              paddingLeft: 18,
              margin: 0,
              fontSize: 12,
              lineHeight: 1.6,
              color: "rgba(255,255,255,.82)",
            }}
          >
            {item.researchHints.map((h, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {h}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ComfyUI 에러 (Mock 폴백 시) */}
      {item.comfyError && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle>⚠ ComfyUI 오류</SectionTitle>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--amber-ink)",
              background: "rgba(250,173,20,.08)",
              border: "1px solid rgba(250,173,20,.25)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 10px",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {item.comfyError}
          </div>
        </section>
      )}

      {/* 비교 분석 — Edit 모드 + 분석 결과가 있을 때만 렌더 (없으면 섹션 자체 숨김) */}
      {item.mode === "edit" && item.comparisonAnalysis && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle>비교 분석</SectionTitle>
          <ComparisonInPanel item={item} />
        </section>
      )}

      {/* ── 메타 (하단) ── 프롬프트 먼저, 참고 정보는 아래 */}
      <section
        style={{
          marginTop: 4,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,.1)",
        }}
      >
        <SectionTitle>Meta</SectionTitle>
        <MetaRow k="모델" v={item.model} />
        <MetaRow
          k="사이즈"
          v={
            item.width > 0 && item.height > 0
              ? `${item.width}×${item.height}`
              : "—"
          }
        />
        {/* video 모드 — LTX 전용 메타 (길이/FPS/프레임/빠른생성/성인모드). Step/CFG/Seed 숨김. */}
        {item.mode === "video" ? (
          <>
            {item.durationSec !== undefined && (
              <MetaRow k="길이" v={`${item.durationSec}s`} />
            )}
            {item.fps !== undefined && (
              <MetaRow k="FPS" v={<span className="mono">{item.fps}</span>} />
            )}
            {item.frameCount !== undefined && (
              <MetaRow
                k="프레임"
                v={<span className="mono">{item.frameCount}</span>}
              />
            )}
            <MetaRow
              k="빠른 생성"
              v={item.lightning ? "⚡ Lightning LoRA" : "표준"}
            />
            {item.adult !== undefined && (
              <MetaRow
                k="성인 모드"
                v={
                  item.adult ? (
                    <span style={{ color: "#ff6b9d" }}>ON</span>
                  ) : (
                    "OFF"
                  )
                }
              />
            )}
          </>
        ) : (
          <>
            <MetaRow
              k="Seed"
              v={<span className="mono">{item.seed}</span>}
            />
            <MetaRow
              k="스텝/CFG"
              v={`${item.steps} · ${item.cfg}${item.lightning ? " ⚡" : ""}`}
            />
          </>
        )}
        {item.promptProvider && (
          <MetaRow
            k="Prompt Provider"
            v={
              <span
                className="mono"
                style={{
                  color:
                    item.promptProvider === "fallback"
                      ? "var(--amber-ink)"
                      : "rgba(255,255,255,.9)",
                }}
              >
                {item.promptProvider}
              </span>
            }
          />
        )}
        <MetaRow
          k="생성일"
          v={new Date(item.createdAt).toLocaleString("ko-KR", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
      </section>
    </aside>
  );
}

/* ─────────────────────────────────
   ComparisonInPanel — Lightbox 내부 비교 분석 카드 + 모달
   별도 컴포넌트로 분리해 useComparisonAnalysis 훅 사용 가능
   (InfoPanel 자체는 hook 사용 위치 부적합 X)
   ───────────────────────────────── */
function ComparisonInPanel({ item }: { item: HistoryItem }) {
  // 비교 분석 훅: 분석 실행 + 진행 상태
  const { analyze, isBusy } = useComparisonAnalysis();
  // 상세 모달 열림/닫힘 state
  const [open, setOpen] = useState(false);
  return (
    <>
      <ComparisonAnalysisCard
        item={item}
        busy={isBusy(item.id)}
        onAnalyze={() => analyze(item)}
        onOpenDetail={() => setOpen(true)}
        onReanalyze={() => analyze(item)}
      />
      {/* 분석 결과 있을 때만 모달 렌더 (z-index 80 — Lightbox 70 위) */}
      {open && item.comparisonAnalysis && (
        <ComparisonAnalysisModal
          item={item}
          analysis={item.comparisonAnalysis}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
        gap: 8,
      }}
    >
      <h4
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,.6)",
        }}
      >
        {children}
      </h4>
      {action}
    </div>
  );
}

function MetaRow({
  k,
  v,
  copyable,
}: {
  k: string;
  v: React.ReactNode;
  copyable?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "80px 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
        fontSize: 12,
        borderBottom: "1px solid rgba(255,255,255,.05)",
      }}
    >
      <span
        style={{
          color: "rgba(255,255,255,.5)",
          fontSize: 11,
          letterSpacing: ".02em",
        }}
      >
        {k}
      </span>
      <span style={{ color: "rgba(255,255,255,.92)", overflow: "hidden" }}>
        {v}
      </span>
      {copyable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copyText(copyable, k);
          }}
          title={`${k} 복사`}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: "var(--radius-sm)",
            fontSize: 10,
            color: "rgba(255,255,255,.5)",
            border: "1px solid rgba(255,255,255,.15)",
          }}
        >
          복사
        </button>
      )}
    </div>
  );
}

function PromptBlock({ text }: { text: string }) {
  // 2026-04-24: 내부 스크롤 제거 — InfoPanel 외부 스크롤 하나로 통일 (중첩 스크롤 UX 개선).
  // 텍스트가 길면 섹션이 세로로 늘어나되 전체 흐름이 명확해짐.
  return (
    <div
      style={{
        fontSize: 12.5,
        lineHeight: 1.55,
        color: "rgba(255,255,255,.88)",
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: "var(--radius-sm)",
        padding: "10px 12px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </div>
  );
}

function CopyChip({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copyText(text, label);
      }}
      title={`${label} 복사`}
      style={{
        all: "unset",
        cursor: "pointer",
        fontSize: 10.5,
        padding: "3px 8px",
        borderRadius: "var(--radius-full)",
        background: "rgba(255,255,255,.08)",
        border: "1px solid rgba(255,255,255,.12)",
        color: "rgba(255,255,255,.85)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Icon name="copy" size={10} />
      복사
    </button>
  );
}
