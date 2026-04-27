/**
 * SizeCard — Generate 페이지 사이즈 카드 (W/H 입력 + 슬라이더 + 비율잠금 + 비율칩).
 *
 * 2026-04-25: AdvancedAccordion → SizeCard 분리 (Lightning 은 호출부에서 직접 노출)
 * 2026-04-26 (task #5): generate/page.tsx 에서 별도 파일로 분리.
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import {
  Field,
  Range,
  inputStyle,
  iconBtnStyle,
} from "@/components/ui/primitives";
import { ASPECT_RATIOS, type AspectRatioLabel } from "@/lib/model-presets";
import type { AspectValue } from "@/stores/useGenerateStore";

interface Props {
  aspect: AspectValue;
  sizeLabel: string;
  width: number;
  height: number;
  aspectLocked: boolean;
  onAspect: (v: AspectRatioLabel) => void;
  onWidth: (v: number) => void;
  onHeight: (v: number) => void;
  onAspectLocked: (v: boolean) => void;
}

/** 카드 grid 에 노출할 비율 4종 (오빠 피드백 — 가장 흔한 비율 우선).
 *  3:4 / 3:2 / 2:3 은 ASPECT_RATIOS 에 살아있어 직접 입력 / 비율잠금 OFF 로 접근 가능. */
const ASPECT_CARD_OPTIONS: AspectRatioLabel[] = ["1:1", "16:9", "9:16", "4:3"];

export default function SizeCard({
  aspect,
  sizeLabel,
  width,
  height,
  aspectLocked,
  onAspect,
  onWidth,
  onHeight,
  onAspectLocked,
}: Props) {
  // 입력 중 raw string — blur/Enter 시에만 store 커밋 (중간값 clamp 방지)
  const [rawW, setRawW] = useState(String(width));
  const [rawH, setRawH] = useState(String(height));

  // store 값이 외부에서 바뀌면(프리셋 칩 클릭 등) raw 도 동기화.
  // React 19 권장: prev state 비교 (effect 안 setState 회피).
  const [prevW, setPrevW] = useState(width);
  const [prevH, setPrevH] = useState(height);
  if (prevW !== width) {
    setPrevW(width);
    setRawW(String(width));
  }
  if (prevH !== height) {
    setPrevH(height);
    setRawH(String(height));
  }

  const commitW = () => {
    const n = parseInt(rawW, 10);
    if (!isNaN(n)) onWidth(n);
    else setRawW(String(width));
  };
  const commitH = () => {
    const n = parseInt(rawH, 10);
    if (!isNaN(n)) onHeight(n);
    else setRawH(String(height));
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        transition: "all .2s",
        padding: "14px 16px 16px",
      }}
    >
      <Field
        label={`사이즈 · ${sizeLabel}${aspect === "custom" ? "" : ` · ${aspect}`}`}
      >
        {/* W/H 세트 — 각 입력박스 바로 아래에 동일 너비 슬라이더 (컴팩트) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* W 세트 (input + slider 세로) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              flex: 1,
              minWidth: 0,
            }}
          >
            <DimInput
              label="W"
              raw={rawW}
              onRaw={setRawW}
              onCommit={commitW}
            />
            <Range
              min={768}
              max={2048}
              step={8}
              value={Math.max(768, width)}
              onChange={onWidth}
            />
          </div>

          {/* 비율잠금 버튼 — 두 열 사이 수직 가운데 정렬 */}
          <button
            type="button"
            onClick={() => onAspectLocked(!aspectLocked)}
            title={
              aspectLocked
                ? "비율 잠금 ON — 한쪽 수정 시 반대쪽 자동 계산"
                : "비율 잠금 OFF — 자유 입력"
            }
            style={{
              ...iconBtnStyle,
              alignSelf: "center",
              background: aspectLocked
                ? "var(--accent-soft)"
                : iconBtnStyle.background,
              color: aspectLocked ? "var(--accent)" : iconBtnStyle.color,
              borderColor: aspectLocked
                ? "var(--accent)"
                : iconBtnStyle.borderColor,
            }}
          >
            <Icon name={aspectLocked ? "lock" : "unlock"} size={13} />
          </button>

          {/* H 세트 — 비율잠금 ON 시 input · slider 모두 disabled */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              flex: 1,
              minWidth: 0,
            }}
          >
            <DimInput
              label="H"
              raw={rawH}
              onRaw={setRawH}
              onCommit={commitH}
              disabled={aspectLocked}
              disabledTitle="비율 잠금 해제 후 직접 입력 가능"
            />
            <Range
              min={768}
              max={2048}
              step={8}
              value={Math.max(768, height)}
              onChange={onHeight}
              disabled={aspectLocked}
            />
          </div>
        </div>

        {/* 비율 카드 grid — 4개 (1:1, 16:9, 9:16, 4:3) · 미니 박스 시각화로 한눈에 비율 파악
         *  2026-04-27 오빠 피드백: 칩 7개 → 카드 4개 + 그림. (3:4 / 3:2 / 2:3 은 비율잠금 OFF + 직접 입력) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
            marginTop: 8,
          }}
        >
          {ASPECT_CARD_OPTIONS.map((label) => {
            const ratio = ASPECT_RATIOS.find((r) => r.label === label)!;
            const active = aspect === ratio.label;
            return (
              <AspectCard
                key={ratio.label}
                label={ratio.label}
                width={ratio.width}
                height={ratio.height}
                active={active}
                onClick={() => onAspect(ratio.label)}
              />
            );
          })}
        </div>
      </Field>
    </div>
  );
}

/** W/H 차원 입력 — label prefix 를 input 안에 overlay 로 얹음 (컴팩트). */
function DimInput({
  label,
  raw,
  onRaw,
  onCommit,
  disabled = false,
  disabledTitle,
}: {
  label: "W" | "H";
  raw: string;
  onRaw: (v: string) => void;
  onCommit: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <span
        aria-hidden
        className="mono"
        style={{
          position: "absolute",
          left: 8,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 10,
          color: "var(--ink-4)",
          pointerEvents: "none",
          fontWeight: 500,
          letterSpacing: ".04em",
        }}
      >
        {label}
      </span>
      <input
        className="mono"
        type="number"
        min={768}
        max={2048}
        step={8}
        value={raw}
        disabled={disabled}
        onChange={(e) => onRaw(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onCommit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{
          ...inputStyle,
          width: "100%",
          paddingLeft: 22,
          textAlign: "right",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "auto",
        }}
        aria-label={label === "W" ? "width px" : "height px"}
        title={disabled ? disabledTitle : undefined}
      />
    </div>
  );
}

/* ─────────────────────────────────────────
   AspectCard — 비율 시각화 카드 (그림 + 라벨)
   2026-04-27 신설.
   미니 박스: 가장 긴 변을 38px 로 정규화 → 비율 그대로 표현 (1:1=정사각, 16:9=가로 직사각, 9:16=세로 직사각, 4:3=살짝 가로).
   ───────────────────────────────────────── */
function AspectCard({
  label,
  width,
  height,
  active,
  onClick,
}: {
  label: string;
  width: number;
  height: number;
  active: boolean;
  onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  // 카드 안 미니 박스 — 가장 긴 변을 38px 로 정규화 후 비율 그대로 표현
  const max = Math.max(width, height);
  const boxW = (width / max) * 38;
  const boxH = (height / max) * 38;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title={`${width}×${height}`}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "10px 4px 8px",
        height: 70,
        boxSizing: "border-box",
        border: `1.5px solid ${
          active ? "var(--accent)" : hov ? "var(--line-2)" : "var(--line)"
        }`,
        borderRadius: "var(--radius-md)",
        background: active
          ? "var(--accent-soft)"
          : hov
          ? "var(--bg-2)"
          : "var(--surface)",
        transition: "all .15s",
      }}
    >
      <div
        aria-hidden
        style={{
          width: boxW,
          height: boxH,
          border: `1.5px solid ${active ? "var(--accent)" : "var(--ink-3)"}`,
          borderRadius: 2,
          transition: "border-color .15s",
        }}
      />
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: ".02em",
          color: active ? "var(--accent)" : "var(--ink-2)",
          transition: "color .15s",
        }}
      >
        {label}
      </span>
    </button>
  );
}
