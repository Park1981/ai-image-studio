/**
 * UpgradeConfirmModal - gemma4 업그레이드 결과를 생성 전에 사용자가 확인/수정.
 *
 * showUpgradeStep 프리퍼런스가 ON 일 때 Generate 페이지 handleGenerate 에서:
 *   1. upgradeOnly() 호출 → 업그레이드 결과 받음
 *   2. 이 모달 띄우기 → 사용자가 확인 또는 수정
 *   3. 사용자가 [이대로 생성] 클릭 → preUpgradedPrompt 로 최종 /generate 호출
 *   4. [수정 (+ 재업그레이드)] 클릭 → 원본 프롬프트로 다시 upgradeOnly
 *   5. [취소] 클릭 → 모달 닫고 생성 자체를 중단
 */

"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";
import type { UpgradeOnlyResult } from "@/lib/api-client";

export interface UpgradeConfirmPayload {
  /** 최종 ComfyUI 로 보낼 영문 프롬프트 (사용자 수정 반영) */
  finalPrompt: string;
  /** 원본 사용자 프롬프트 (히스토리 기록용) */
  originalPrompt: string;
  /** 조사 힌트 (받은 경우) */
  researchHints: string[];
}

interface Props {
  open: boolean;
  loading: boolean;
  original: string;
  result: UpgradeOnlyResult | null;
  onConfirm: (p: UpgradeConfirmPayload) => void;
  onRerun: () => void;
  onCancel: () => void;
}

export default function UpgradeConfirmModal({
  open,
  loading,
  original,
  result,
  onConfirm,
  onRerun,
  onCancel,
}: Props) {
  // 사용자가 수정한 프롬프트 → edit state. result 가 새로 오면 reset (key 로 리셋).
  // setState in effect 안티패턴 피하려고 key 기반 remount 방식.
  const resultKey = result?.upgradedPrompt ?? "";
  return (
    <EditorShell
      open={open}
      loading={loading}
      original={original}
      result={result}
      key={resultKey}
      onConfirm={onConfirm}
      onRerun={onRerun}
      onCancel={onCancel}
    />
  );
}

function EditorShell({
  open,
  loading,
  original,
  result,
  onConfirm,
  onRerun,
  onCancel,
}: Props) {
  const [edit, setEdit] = useState(result?.upgradedPrompt ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ESC = cancel
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onCancel]);

  if (!open) return null;

  const canSubmit = !loading && edit.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="프롬프트 업그레이드 확인"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 65,
        background: "rgba(23, 20, 14, 0.42)",
        display: "grid",
        placeItems: "center",
        animation: "fade-in .18s ease",
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <section
        style={{
          background: "var(--bg)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--line)",
          width: "min(680px, 100%)",
          maxHeight: "88vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            <Icon name="sparkle" size={14} />
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: 0,
              }}
            >
              프롬프트 업그레이드 확인
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            style={{
              all: "unset",
              cursor: "pointer",
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
            }}
            title="취소 (ESC)"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* 원본 */}
          <Section label="원본 입력">
            <p style={originalStyle}>{original}</p>
          </Section>

          {/* 로딩 */}
          {loading && (
            <div
              style={{
                padding: "30px 20px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                justifyContent: "center",
                color: "var(--ink-3)",
                fontSize: 13,
              }}
            >
              <Spinner size={14} color="var(--accent)" />
              gemma4 가 프롬프트 업그레이드 중…
            </div>
          )}

          {/* 결과 */}
          {!loading && result && (
            <>
              <Section
                label={`gemma4 업그레이드 결과 (${result.provider}${result.fallback ? " · 폴백" : ""})`}
                hint="수정하고 [이대로 생성] 누르면 아래 영문 프롬프트로 진행. [재업그레이드] 는 gemma4 를 다시 돌려."
              >
                <textarea
                  ref={textareaRef}
                  value={edit}
                  onChange={(e) => setEdit(e.target.value)}
                  rows={7}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    fontSize: 13,
                    fontFamily: "inherit",
                    lineHeight: 1.6,
                    color: "var(--ink)",
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius)",
                    resize: "vertical",
                    boxShadow: "var(--shadow-sm)",
                    outline: "none",
                  }}
                />
              </Section>

              {/* 한국어 번역 (gemma4 가 같이 반환) */}
              {result.upgradedPromptKo && (
                <Section
                  label="한국어 번역"
                  hint="영문 프롬프트의 의미를 gemma4 가 번역한 결과. 생성엔 영향 없음 (참고용)."
                >
                  <p
                    style={{
                      margin: 0,
                      padding: "10px 14px",
                      background: "var(--bg-2)",
                      border: "1px dashed var(--line)",
                      borderRadius: "var(--radius)",
                      fontSize: 12.5,
                      color: "var(--ink-2)",
                      lineHeight: 1.65,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {result.upgradedPromptKo}
                  </p>
                </Section>
              )}

              {result.researchHints.length > 0 && (
                <Section label="Claude 조사 힌트">
                  <ul
                    style={{
                      margin: 0,
                      padding: "6px 0 0 18px",
                      fontSize: 12,
                      color: "var(--ink-2)",
                      lineHeight: 1.55,
                    }}
                  >
                    {result.researchHints.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <footer
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            background: "var(--bg-2)",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={secondaryBtnStyle}
          >
            취소
          </button>
          <button
            type="button"
            onClick={onRerun}
            disabled={loading}
            style={{
              ...secondaryBtnStyle,
              opacity: loading ? 0.5 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
            title="원본 프롬프트로 gemma4 다시 실행"
          >
            재업그레이드
          </button>
          <button
            type="button"
            onClick={() =>
              canSubmit &&
              onConfirm({
                finalPrompt: edit.trim(),
                originalPrompt: original,
                researchHints: result?.researchHints ?? [],
              })
            }
            disabled={!canSubmit}
            style={{
              ...primaryBtnStyle,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            이대로 생성
          </button>
        </footer>
      </section>
    </div>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: ".06em",
          color: "var(--ink-3)",
        }}
      >
        {label}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 2 }}>
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}

const originalStyle: React.CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  background: "var(--bg-2)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  fontSize: 12.5,
  color: "var(--ink-2)",
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const primaryBtnStyle: React.CSSProperties = {
  all: "unset",
  padding: "8px 16px",
  borderRadius: "var(--radius-sm)",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0,
  boxShadow: "0 2px 8px rgba(74,158,255,.28)",
};

const secondaryBtnStyle: React.CSSProperties = {
  all: "unset",
  padding: "8px 14px",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface)",
  color: "var(--ink-2)",
  border: "1px solid var(--line)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
