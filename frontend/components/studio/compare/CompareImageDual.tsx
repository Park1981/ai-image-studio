/**
 * CompareImageDual — V4 분리 thumbnail 좌/우 + on-demand t2i prompt 합성 버튼.
 * spec §5.3.2 + §5.3.7.
 *
 * 핵심 정책:
 *  - 전역 직렬화: 한 시점에 한 이미지만 합성 진행 (양쪽 버튼 모두 disabled when inFlight)
 *  - 진행 모달 X · 인라인 spinner ("프롬프트 합성 중...")
 *  - 합성 완료 후 thumbnail 아래 펼침 영역에 prompt 표시 + 재합성 버튼
 *  - 휘발 캐시 (페이지 떠나면 사라짐)
 */

"use client";

import type { PerImagePromptResult, PerImageWhich } from "@/stores/useVisionCompareStore";

interface Props {
  image1Url: string;
  image2Url: string;
  image1Prompt: PerImagePromptResult | null;
  image2Prompt: PerImagePromptResult | null;
  inFlight: PerImageWhich | null;
  onPromptRequest: (which: PerImageWhich) => void;
  onPromptReset: (which: PerImageWhich) => void;
}

export default function CompareImageDual({
  image1Url,
  image2Url,
  image1Prompt,
  image2Prompt,
  inFlight,
  onPromptRequest,
  onPromptReset,
}: Props) {
  const busy = inFlight !== null;

  return (
    <div
      className="ais-compare-image-dual"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
      }}
    >
      <ImagePane
        which="image1"
        label="A"
        url={image1Url}
        prompt={image1Prompt}
        busy={busy}
        active={inFlight === "image1"}
        onRequest={() => onPromptRequest("image1")}
        onReset={() => onPromptReset("image1")}
      />
      <ImagePane
        which="image2"
        label="B"
        url={image2Url}
        prompt={image2Prompt}
        busy={busy}
        active={inFlight === "image2"}
        onRequest={() => onPromptRequest("image2")}
        onReset={() => onPromptReset("image2")}
      />
    </div>
  );
}

function ImagePane({
  which,
  label,
  url,
  prompt,
  busy,
  active,
  onRequest,
  onReset,
}: {
  which: PerImageWhich;
  label: string;
  url: string;
  prompt: PerImagePromptResult | null;
  busy: boolean;
  active: boolean;
  onRequest: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className="ais-compare-image-pane"
      data-which={which}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {/* 썸네일 */}
      <div
        style={{
          position: "relative",
          aspectRatio: "1 / 1",
          background: "var(--bg-2, #0f172a)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`compare ${label}`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
          }}
        >
          {label}
        </span>
      </div>

      {/* 합성 버튼 (idle / spinner) */}
      <button
        type="button"
        onClick={onRequest}
        disabled={busy}
        aria-label={active ? "합성 중" : "이 이미지 t2i prompt 만들기"}
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px solid var(--line-1, rgba(148, 163, 184, 0.3))",
          background: active ? "var(--bg-3, #1e293b)" : "transparent",
          color: "var(--ink-1)",
          fontSize: 13,
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy && !active ? 0.5 : 1,
        }}
      >
        {active ? "프롬프트 합성 중..." : "이 이미지 t2i prompt 만들기"}
      </button>

      {/* 결과 영역 */}
      {prompt && (
        <div
          className="ais-compare-image-prompt"
          style={{
            padding: 12,
            borderRadius: 8,
            background: "var(--bg-2, rgba(148, 163, 184, 0.08))",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 12,
            color: "var(--ink-2)",
          }}
        >
          {prompt.summary && (
            <div style={{ fontWeight: 600, color: "var(--ink-1)" }}>
              {prompt.summary}
            </div>
          )}
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {prompt.positive_prompt}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              aria-label="재합성"
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid var(--line-1)",
                background: "transparent",
                color: "var(--ink-2)",
                fontSize: 12,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              재합성
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
