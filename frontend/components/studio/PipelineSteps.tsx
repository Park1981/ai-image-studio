/**
 * PipelineSteps — Edit/Video 페이지의 자동 처리 초록 박스.
 * 2026-04-23 Opus F5: edit/page.tsx 에서 분리.
 * 2026-04-24 audit P1b: 실행 중에는 compact 1줄 요약으로 자동 축소
 *   (정보 중복 해소 — 상세 진행은 ProgressModal 이 primary).
 * 2026-04-25 Codex 리뷰 fix: footer 정보를 외부 주입으로 분리
 *   (Edit 전용 하드코딩 → 호출부에서 footerLabel/footerEta 전달).
 *   Video 페이지에 EDIT_MODEL LoRA 개수와 38s ETA 가 잘못 표시되던 문제 해결.
 *
 * 모드별 표시:
 *   - 실행 전 (running=false, stepDone=0): 전체 상세 (예정 단계 안내 가치)
 *   - 실행 중 (running=true): compact 1줄 "진행 중 · {currentStep}/{total}"
 *     → 좌측 패널 공간 절약 + 사용자 시선을 모달에 집중
 *   - 완료 후 (running=false, stepDone>=total): 전체 상세 (참고용)
 */

"use client";

import Icon from "@/components/ui/Icon";
import { StepMark } from "@/components/ui/primitives";

export interface PipelineStepMeta {
  n: number;
  label: string;
  model: string;
}

interface PipelineStepsProps {
  steps: PipelineStepMeta[];
  /** 현재 완료된 step 번호 (0=시작 전) */
  stepDone: number;
  /** 현재 실행 중인 step 번호 (1~4), 없으면 null */
  currentStep: number | null;
  /** 전체 파이프라인 실행 중 여부 (false 면 running 아이콘 안 그림) */
  running: boolean;
  /** Footer 좌측 — 예: "ComfyUI · LoRA +1" / "ComfyUI · LTX-2.3 22B".
   *  호출부가 자기 모델에 맞는 라벨을 구성해 주입 (모델-agnostic). */
  footerLabel: string;
  /** Footer 우측 ETA — 호출부에서 lightning 분기 후 완성된 문자열 전달.
   *  예: "~12s 예상" / "~38s 예상" / "~5분 예상" / "~20분+ 예상". */
  footerEta: string;
}

export default function PipelineSteps({
  steps,
  stepDone,
  currentStep,
  running,
  footerLabel,
  footerEta,
}: PipelineStepsProps) {
  // audit P1b: 실행 중 compact 뷰 — 상세 진행은 ProgressModal 에서만 표시.
  if (running) {
    const runningStep = steps.find((s) => s.n === currentStep);
    const runningLabel = runningStep?.label ?? "대기";
    return (
      <div
        style={{
          background: "var(--green-soft)",
          border: "1px solid rgba(82,196,26,.28)",
          borderRadius: "var(--radius)",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12,
          color: "var(--green-ink)",
        }}
      >
        <Icon name="cpu" size={13} />
        <span
          style={{
            fontWeight: 600,
            letterSpacing: 0,
          }}
        >
          자동 처리 중
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            opacity: 0.8,
            letterSpacing: ".04em",
          }}
        >
          STEP {currentStep ?? "-"}/{steps.length} · {runningLabel}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10.5,
            color: "var(--ink-4)",
          }}
        >
          자세히는 진행 모달
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--green-soft)",
        border: "1px solid rgba(82,196,26,.28)",
        borderRadius: "var(--radius)",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--green-ink)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            letterSpacing: 0,
          }}
        >
          <Icon name="cpu" size={13} />
          자동 처리 단계
        </div>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--green-ink)",
            opacity: 0.7,
            letterSpacing: ".05em",
          }}
        >
          AUTO · {steps.length} STEPS
        </span>
      </div>

      <ol
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {steps.map((step) => {
          const done = stepDone >= step.n;
          const isRunning = running && currentStep === step.n && !done;
          return (
            <li
              key={step.n}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 12,
                color: "var(--ink-2)",
                padding: "4px 0",
              }}
            >
              <StepMark done={done} running={isRunning} />
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  minWidth: 0,
                }}
              >
                <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
                  {step.n}. {step.label}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    color: "var(--ink-4)",
                    letterSpacing: ".02em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {step.model}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px dashed rgba(82,196,26,.3)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "var(--green-ink)",
        }}
      >
        <Icon name="arrow-right" size={12} />
        <span style={{ fontWeight: 500 }}>{footerLabel}</span>
        <span
          className="mono"
          style={{
            color: "var(--ink-4)",
            marginLeft: "auto",
            letterSpacing: ".04em",
          }}
        >
          {footerEta}
        </span>
      </div>
    </div>
  );
}
