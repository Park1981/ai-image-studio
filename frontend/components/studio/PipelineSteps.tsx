/**
 * PipelineSteps — Edit 페이지의 4단계 자동 처리 초록 박스.
 * 2026-04-23 Opus F5: edit/page.tsx 에서 분리 (~129줄 → 별도 컴포넌트).
 *
 * step 번호 + 라벨 + 모델명 + 진행 상태(done/running/pending) 아이콘.
 * 하단 바: ComfyUI LoRA 수 + 예상 소요 시간.
 */

"use client";

import Icon from "@/components/ui/Icon";
import { StepMark } from "@/components/ui/primitives";
import { EDIT_MODEL, countExtraLoras } from "@/lib/model-presets";

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
  /** Lightning 모드 여부 — 예상 소요 시간 분기용 */
  lightning: boolean;
}

export default function PipelineSteps({
  steps,
  stepDone,
  currentStep,
  running,
  lightning,
}: PipelineStepsProps) {
  return (
    <div
      style={{
        background: "var(--green-soft)",
        border: "1px solid rgba(82,196,26,.28)",
        borderRadius: 12,
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
            letterSpacing: "-0.005em",
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
        <span style={{ fontWeight: 500 }}>
          ComfyUI · LoRA +{countExtraLoras(EDIT_MODEL)}
        </span>
        <span
          className="mono"
          style={{
            color: "var(--ink-4)",
            marginLeft: "auto",
            letterSpacing: ".04em",
          }}
        >
          ~{lightning ? "12" : "38"}s 예상
        </span>
      </div>
    </div>
  );
}
