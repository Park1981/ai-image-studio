"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";

type AnalysisMode = "vision" | "compare";

const STEPS: Record<
  AnalysisMode,
  Array<{ label: string; model: string; desc: string }>
> = {
  vision: [
    {
      label: "이미지 인코딩",
      model: "browser",
      desc: "업로드 이미지를 비전 모델 입력으로 준비",
    },
    {
      label: "비전 모델 분석",
      model: "qwen2.5vl",
      desc: "피사체, 구성, 분위기를 텍스트로 추출",
    },
    {
      label: "EN/KO 결과 정리",
      model: "ollama",
      desc: "영문 설명과 한국어 번역을 결과 카드에 반영",
    },
  ],
  compare: [
    {
      label: "이미지 A/B 준비",
      model: "browser",
      desc: "두 이미지를 비교 입력으로 인코딩",
    },
    {
      label: "비전 비교 분석",
      model: "qwen2.5vl",
      desc: "두 이미지를 한 번에 전달해 차이를 분석",
    },
    {
      label: "5축 점수 정리",
      model: "ollama",
      desc: "구성, 색감, 피사체, 분위기, 품질 점수와 코멘트 정규화",
    },
    {
      label: "한글 결과 정리",
      model: "gemma4-un",
      desc: "영문 코멘트와 총평을 한국어로 번역",
    },
  ],
};

export default function AnalysisProgressModal({
  mode,
  running,
  onClose,
}: {
  mode: AnalysisMode;
  running: boolean;
  onClose: () => void;
}) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const title = mode === "vision" ? "비전 분석 중" : "비교 분석 중";
  const steps = STEPS[mode];
  // audit P1a: 기존 `running ? (compare?50:66) : 100` 고정 percent 제거.
  // 백엔드에서 실제 단계 이벤트를 보내지 않으므로 숫자 대신 indeterminate bar 로
  // 정직하게 표현. 완료 시에만 100% 를 체크 아이콘 + 녹색으로 드러낸다.

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(23, 20, 14, 0.42)",
        display: "grid",
        placeItems: "center",
        animation: "fade-in .18s ease",
        padding: 20,
      }}
    >
      <section
        style={{
          background: "var(--bg)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--line)",
          width: "min(560px, 100%)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          animation: "scale-in .22s cubic-bezier(.22,1,.36,1)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {running ? (
              <Spinner size={14} color="var(--accent)" />
            ) : (
              <Icon name="check" size={15} style={{ color: "var(--green)" }} />
            )}
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: 0,
              }}
            >
              {running ? title : "분석 완료"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="모달 닫기"
            aria-label="닫기"
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
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div
          style={{
            padding: "10px 20px",
            background: "var(--bg-2)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12,
          }}
        >
          <span className="mono" style={{ color: "var(--ink-2)" }}>
            {String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:
            {String(elapsedSec % 60).padStart(2, "0")}
          </span>
          <span
            className="mono"
            style={{
              color: running ? "var(--ink-3)" : "var(--green)",
              fontWeight: 600,
              letterSpacing: ".04em",
            }}
          >
            {running ? "분석 중" : "100%"}
          </span>
        </div>

        <div style={{ padding: "16px 22px 22px" }}>
          <div
            style={{
              height: 6,
              background: "var(--line-2)",
              borderRadius: "var(--radius-full)",
              overflow: "hidden",
              marginBottom: 14,
              position: "relative",
            }}
          >
            {running ? (
              // Indeterminate bar — 실제 progress 이벤트가 없으므로
              // 좌우로 왕복하는 30% 폭 bar 로 "작업 중" 만 표현.
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  height: "100%",
                  width: "30%",
                  background: "var(--accent)",
                  borderRadius: "var(--radius-full)",
                  animation: "apm-indeterminate 1.4s ease-in-out infinite",
                }}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  width: "100%",
                  background: "var(--green)",
                  transition: "width .25s ease",
                }}
              />
            )}
          </div>

          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {steps.map((step, i) => {
              const done = !running || i === 0;
              const active = running && i === 1;
              return (
                <li
                  key={step.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "6px 0",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      border: done
                        ? "1.5px solid var(--green)"
                        : active
                          ? "1.5px solid var(--accent)"
                          : "1.5px solid var(--line-2)",
                      background: done ? "var(--green)" : "#fff",
                      color: done ? "#fff" : "var(--ink-4)",
                    }}
                  >
                    {done ? (
                      <Icon name="check" size={12} stroke={2.5} />
                    ) : active ? (
                      <Spinner size={10} color="var(--accent)" />
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 600 }}>
                        {i + 1}
                      </span>
                    )}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        fontSize: 13,
                        fontWeight: 500,
                        color: active || done ? "var(--ink)" : "var(--ink-4)",
                      }}
                    >
                      {step.label}
                      <span
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          color: "var(--ink-4)",
                          letterSpacing: ".04em",
                        }}
                      >
                        {step.model}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--ink-3)",
                        marginTop: 2,
                      }}
                    >
                      {step.desc}
                    </div>
                  </div>
                  {active && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: "var(--accent)",
                        letterSpacing: ".04em",
                      }}
                    >
                      RUNNING
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}

/* indeterminate bar keyframes — SSR 안전한 runtime 주입 (ProgressModal 과 동일 패턴) */
if (typeof document !== "undefined" && !document.getElementById("apm-kf")) {
  const s = document.createElement("style");
  s.id = "apm-kf";
  s.textContent = `
@keyframes apm-indeterminate {
  0%   { left: -30%; }
  50%  { left: 40%; }
  100% { left: 100%; }
}
`;
  document.head.appendChild(s);
}
