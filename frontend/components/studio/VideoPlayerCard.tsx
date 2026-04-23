/**
 * VideoPlayerCard — LTX-2.3 i2v 결과 영상 재생 카드.
 * 2026-04-24 · V6.
 *
 * 3 상태:
 *  - loading (running=true): Spinner + 단계 라벨 + progress bar
 *  - empty (src=null, !running): 업로드 후 생성 대기 안내
 *  - filled (src 존재): <video controls> 재생 + 저장/URL 복사 버튼
 */

"use client";

import { SmallBtn, Spinner } from "@/components/ui/primitives";
import { downloadImage, copyText } from "@/lib/image-actions";

interface Props {
  src: string | null;
  running: boolean;
  progress?: number;
  label?: string;
  /** 다운로드 시 제안할 파일명 */
  filename?: string;
}

export default function VideoPlayerCard({
  src,
  running,
  progress = 0,
  label,
  filename,
}: Props) {
  // ── Loading ──
  if (running) {
    const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    return (
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: "28px 22px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          color: "var(--ink-3)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <Spinner />
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--ink-2)",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {label || "영상 생성 중…"}
        </div>
        <div
          style={{
            width: "100%",
            height: 6,
            background: "var(--bg-2)",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${clampedProgress}%`,
              height: "100%",
              background: "var(--accent)",
              transition: "width .35s ease",
            }}
          />
        </div>
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-4)" }}
        >
          {clampedProgress}% · 평균 소요 5~20분 (로컬)
        </div>
      </div>
    );
  }

  // ── Empty ──
  if (!src || src.startsWith("mock-seed://")) {
    return (
      <div
        style={{
          padding: "28px 20px",
          background: "var(--surface)",
          border: "1px dashed var(--line-2)",
          borderRadius: 14,
          textAlign: "center",
          color: "var(--ink-4)",
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        원본 이미지 + 영상 지시를 입력하고
        <br />
        <b>영상 생성</b> 버튼을 눌러봐.
      </div>
    );
  }

  // ── Filled ──
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element — video element */}
      <video
        src={src}
        controls
        loop
        playsInline
        preload="metadata"
        style={{
          width: "100%",
          display: "block",
          background: "#0a0a0a",
          maxHeight: "60vh",
        }}
      />
      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          borderTop: "1px solid var(--line)",
        }}
      >
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-4)" }}
        >
          MP4 · H.264 + AAC
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <SmallBtn
            icon="download"
            onClick={() => downloadImage(src, filename || "ais-video.mp4")}
          >
            저장
          </SmallBtn>
          <SmallBtn
            icon="copy"
            onClick={() => copyText(src, "영상 URL")}
          >
            URL
          </SmallBtn>
        </div>
      </div>
    </div>
  );
}

