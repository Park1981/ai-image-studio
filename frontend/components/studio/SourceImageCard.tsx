/**
 * SourceImageCard — Edit/Video/Vision 페이지의 원본 이미지 카드.
 * 2026-04-24 audit R3-1: StudioUploadSlot 기반으로 재작성.
 *
 * 역할:
 *   - 파일 업로드 로직 (FileReader + Image.onload 로 크기 추출) 은 이 컴포넌트 담당.
 *   - empty/filled shell · 드래그 이벤트는 StudioUploadSlot 이 담당.
 *   - filled 상태의 4 오버레이 (info popover · × 해제 · 사이즈 배지 · 변경 버튼) 는
 *     이 컴포넌트가 children 으로 직접 구성.
 *
 * props 인터페이스는 기존과 동일 (edit/video/vision 페이지 무영향).
 */

"use client";

import { useState, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";
import StudioUploadSlot from "@/components/studio/StudioUploadSlot";

interface SourceImageCardProps {
  sourceImage: string | null;
  sourceLabel: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  /** 업로드/변경 완료 시 */
  onChange: (image: string, label: string, w: number, h: number) => void;
  /** × 해제 */
  onClear: () => void;
  /** 업로드 실패 시 토스트 노출용 — 부모가 레벨(error/warn) 판단 */
  onError: (message: string) => void;
  /** Multi-ref 등 멀티 슬롯 페이지에서 paste 충돌 방지 — 호버한 카드만 paste 수용.
   *  default false (옛 동작 유지 — 단일 슬롯 페이지 호환). */
  pasteRequireHover?: boolean;
}

export default function SourceImageCard({
  sourceImage,
  sourceLabel,
  sourceWidth,
  sourceHeight,
  onChange,
  onClear,
  onError,
  pasteRequireHover = false,
}: SourceImageCardProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  // StudioUploadSlot.onReady 로 받아둔 trigger — 변경 버튼 클릭 시 호출.
  const [pickFn, setPickFn] = useState<(() => void) | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      onError("이미지 파일만 업로드 가능");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // 이미지 크기 읽기 — "use client" 가드 하에 window.Image 사용 (SSR 무관)
      const img = new Image();
      img.onload = () => {
        onChange(
          dataUrl,
          `${file.name} · ${img.naturalWidth}×${img.naturalHeight}`,
          img.naturalWidth,
          img.naturalHeight,
        );
      };
      img.onerror = () => onError("이미지 로드 실패");
      img.src = dataUrl;
    };
    reader.onerror = () => onError("파일 읽기 실패");
    reader.readAsDataURL(file);
  };

  const handleClear = () => {
    onClear();
    setInfoOpen(false);
  };

  return (
    <div style={{ position: "relative" }}>
      {/* 정보 팝오버 — ⓘ 클릭 시 카드 위에 표시 */}
      {infoOpen && sourceImage && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            padding: "10px 12px",
            zIndex: 20,
            boxShadow: "0 4px 16px rgba(0,0,0,.1)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
          }}
        >
          <Icon
            name="check"
            size={10}
            style={{ color: "var(--green)", flexShrink: 0 }}
          />
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "var(--ink-2)",
            }}
          >
            {sourceLabel}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            style={{
              all: "unset",
              cursor: "pointer",
              color: "var(--ink-3)",
              fontSize: 11,
              textDecoration: "underline",
              textUnderlineOffset: 3,
              flexShrink: 0,
            }}
          >
            해제
          </button>
        </div>
      )}

      {/* StudioUploadSlot — shell + 드래그/드롭/paste 로직 담당 */}
      <StudioUploadSlot
        filled={!!sourceImage}
        height={256}
        onFiles={handleFiles}
        acceptDropWhenFilled
        // P-3: 단일 slot 페이지(edit/video/vision) 는 호버 무관 전역 paste 허용.
        // Multi-ref ON 시 (Edit Phase 2) 두 카드가 같은 paste 이벤트를 잡으면
        // 비결정적이라 부모가 pasteRequireHover=true 로 호버 카드만 받도록 강제.
        // textarea/input focus 시 자동 skip (StudioUploadSlot 내부 가드).
        pasteEnabled
        pasteRequireHover={pasteRequireHover}
        onReady={(pick) => setPickFn(() => pick)}
        emptyContent={
          <>
            <Icon name="upload" size={22} style={{ color: "var(--ink-4)" }} />
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--ink-3)",
                marginTop: 8,
              }}
            >
              드래그 또는 클릭
            </div>
            <div
              style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 2 }}
            >
              PNG · JPG · WebP
            </div>
          </>
        }
      >
        {sourceImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceImage}
              alt={sourceLabel}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
                // 레터박스 배경 warm neutral (audit P0-1 유지)
                background: "var(--bg-2)",
              }}
            />
            {/* 하단 그라디언트 — 배지/버튼 가독성용 (audit R1-3 에서 .42 강도로 완화) */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(to top, rgba(0,0,0,.42) 0%, transparent 55%)",
                pointerEvents: "none",
              }}
            />
            {/* 사이즈 배지 — bottom-left */}
            {sourceWidth && sourceHeight && (
              <span
                className="mono"
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 10,
                  fontSize: 10,
                  color: "rgba(255,255,255,.85)",
                  letterSpacing: ".04em",
                  background: "rgba(0,0,0,.35)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  pointerEvents: "none",
                }}
              >
                {sourceWidth}×{sourceHeight}
              </span>
            )}
            {/* ⓘ 상세 — top-left (단일 이미지 컨텍스트) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setInfoOpen((v) => !v);
              }}
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: infoOpen
                  ? "rgba(255,255,255,.9)"
                  : "rgba(0,0,0,.4)",
                color: infoOpen ? "var(--ink)" : "#fff",
                border: "none",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "serif",
                lineHeight: 1,
              }}
              title="상세 정보"
            >
              i
            </button>
            {/* 변경 + 해제 — top-right cluster (CompareImageSlot 와 디자인 통일 · 2026-04-27).
             *  ActionPill: blur 배경 + round-full + 아이콘+텍스트. */}
            <div
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                display: "flex",
                gap: 6,
              }}
            >
              <ActionPill
                title="이미지 변경"
                onClick={() => pickFn?.()}
              >
                <Icon name="refresh" size={11} /> 변경
              </ActionPill>
              <ActionPill title="이미지 해제" onClick={handleClear}>
                <Icon name="x" size={11} />
              </ActionPill>
            </div>
          </>
        )}
      </StudioUploadSlot>
    </div>
  );
}

/** ActionPill — blur 배경 + round-full pill 버튼.
 *  CompareImageSlot 와 동일 스타일 (오빠 피드백 2026-04-27 — 두 컴포넌트 통일).
 *  추후 두 곳 외에 더 쓰이면 별도 파일로 추출 검토. */
function ActionPill({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        background: "rgba(0,0,0,.55)",
        backdropFilter: "blur(6px)",
        color: "#fff",
        fontSize: 11,
        borderRadius: "var(--radius-full)",
      }}
    >
      {children}
    </button>
  );
}
