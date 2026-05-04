/**
 * VideoPlayerCard — LTX-2.3 i2v 결과 영상 재생 카드.
 * 2026-04-24 · V6 → audit P1b: loading 상태 축소 (progress bar + % 제거).
 *
 * 4 상태:
 *  - loading (running=true): StudioLoadingState 표시
 *    (상세 진행률은 ProgressModal 이 단일 primary — 중복 제거)
 *  - mock (src="mock-seed://..."): 가짜 결과 안내 박스 (NEXT_PUBLIC_USE_MOCK 시)
 *  - empty (src 없음, !running): StudioEmptyState 표시
 *  - filled (valid src): 매트 카드 + video player
 */

"use client";

import { SmallBtn } from "@/components/ui/primitives";
import StudioEmptyState from "@/components/studio/StudioEmptyState";
import StudioLoadingState from "@/components/studio/StudioLoadingState";
import { downloadImage, copyText } from "@/lib/image-actions";

interface Props {
  src: string | null;
  running: boolean;
  /** @deprecated audit P1b 에서 loading 내부 progress bar 제거됨. props 는 하위호환 용도로만 유지. */
  progress?: number;
  label?: string;
  /** 다운로드 시 제안할 파일명 */
  filename?: string;
  /** 크게 보기 (라이트박스 열기). 있을 때만 버튼 노출. */
  onExpand?: () => void;
}

export default function VideoPlayerCard({
  src,
  running,
  label,
  filename,
  onExpand,
}: Props) {
  // ── Loading ── (audit R2-8: 공통 StudioLoadingState 로 교체)
  if (running) {
    return (
      <StudioLoadingState
        title={label || "영상 생성 중…"}
        description="평균 소요 5~20분 · 상세 진행은 위 모달"
      />
    );
  }

  // ── Mock 결과 (실 mp4 없음) ──
  if (src && src.startsWith("mock-seed://")) {
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

  // ── Empty ── (audit R2-8: 공통 StudioEmptyState 로 교체)
  if (!src) {
    return (
      <StudioEmptyState size="normal">
        원본 이미지와 영상 지시를 입력하고
        <br />
        <b>영상 생성</b> 버튼을 눌러 주세요.
      </StudioEmptyState>
    );
  }

  // ── Filled ── 2026-05-04 통일 plan: .ais-result-hero 매트 카드 className 전환.
  // .ais-result-hero base 의 aspect-ratio 1672/941 은 video 에 부적합 →
  // .ais-result-hero-edit modifier 로 aspect-ratio:auto + flex column + stretch +
  // padding 24 자동 적용 (Edit 패턴 재사용).
  return (
    <div className="ais-result-hero ais-result-hero-edit">
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

