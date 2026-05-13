/**
 * VideoContent — LTX-2.3 i2v 결과 영상 본문.
 *
 * empty/loading/outer wrapper 는 ResultBox 가 담당한다.
 * mock 결과 안내는 "완료 본문"의 특수 케이스라 여기서 보존한다.
 */

"use client";

import { SmallBtn } from "@/components/ui/primitives";
import { downloadImage, copyText } from "@/lib/image-actions";

interface Props {
  src: string;
  /** 다운로드 시 제안할 파일명 */
  filename?: string;
  /** 크게 보기 (라이트박스 열기). 있을 때만 버튼 노출. */
  onExpand?: () => void;
}

export default function VideoContent({
  src,
  filename,
  onExpand,
}: Props) {
  // ── Mock 결과 (실 mp4 없음) ──
  if (src.startsWith("mock-seed://")) {
    return (
      <div
        style={{
          padding: "28px 20px",
          background: "var(--surface)",
          border: "1px dashed var(--line-2)",
          borderRadius: "var(--radius-card)",
          textAlign: "center",
          color: "var(--ink-3)",
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--ink-2)" }}>
          Mock 영상 생성 완료
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>
          실제 mp4가 없는 Mock 결과입니다. 실 ComfyUI 연결은
          <br />
          <code
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            NEXT_PUBLIC_USE_MOCK=false
          </code>{" "}
          환경변수로 활성화해 주세요.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "min(100%, 1040px)",
        marginInline: "auto",
      }}
    >
      {/* video element — 매트 위 떠있는 영상 (자체 그림자 + 옅은 테두리) */}
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
          borderRadius: "var(--radius-md)",
          boxShadow:
            "0 10px 32px rgba(0,0,0,.14), 0 3px 10px rgba(0,0,0,.08)",
          border: "1px solid rgba(0,0,0,.06)",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          // padding/border 제거 — 매트 padding 안에서 footer 자연 정렬
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
          <SmallBtn icon="copy" onClick={() => copyText(src, "영상 URL")}>
            URL
          </SmallBtn>
          {onExpand && (
            <SmallBtn icon="zoom-in" onClick={onExpand}>
              크게
            </SmallBtn>
          )}
        </div>
      </div>
    </div>
  );
}

