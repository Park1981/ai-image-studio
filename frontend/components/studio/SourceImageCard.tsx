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

import { useState } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
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
  // StudioUploadSlot.onReady 로 받아둔 trigger — 변경 버튼 클릭 시 호출.
  const [pickFn, setPickFn] = useState<(() => void) | null>(null);

  // 시안 매칭 (2026-05-02): sourceLabel 형식 `${file.name} · ${w}×${h}` 에서 파일명만 추출.
  const filename = sourceLabel.split(" · ")[0] || sourceLabel;
  // 파일명 끝 확장자 → 형식 라벨 (대문자). 없으면 PNG fallback.
  const formatExt =
    (filename.split(".").pop() || "png").toUpperCase().slice(0, 5) || "PNG";

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
  };

  return (
    <div style={{ position: "relative" }}>
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
            {/* 시안 매칭 (2026-05-03): 하단 라벨 — frosted 띠 배경 제거 + 텍스트 그림자만.
             *  옛 ⓘ 정보 팝오버 + 좌하단 사이즈 배지 → 통합 (정보 한 곳).
             *  4 페이지 (Edit/Video/Vision/Compare) 통일 패턴. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                color: "#fff",
                fontSize: 12,
                fontWeight: 500,
                textShadow:
                  "0 2px 6px rgba(0,0,0,.85), 0 0 4px rgba(0,0,0,.6)",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.01em",
                }}
                title={filename}
              >
                {filename}
              </span>
              {sourceWidth && sourceHeight && (
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,.92)",
                    letterSpacing: ".04em",
                    flexShrink: 0,
                  }}
                >
                  {sourceWidth} × {sourceHeight} · {formatExt}
                </span>
              )}
            </div>
            {/* 시안 매칭 (2026-05-02): 우상단 둥근 frosted glass 아이콘 버튼 2개 — refresh + x.
             *  옛 ActionPill 텍스트("변경") 제거 — 시안 스타일 (icon-only round). */}
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                display: "flex",
                gap: 6,
              }}
            >
              <RoundIconBtn
                title="이미지 변경"
                icon="refresh"
                onClick={() => pickFn?.()}
              />
              <RoundIconBtn
                title="이미지 해제"
                icon="x"
                onClick={handleClear}
              />
            </div>
          </>
        )}
      </StudioUploadSlot>
    </div>
  );
}

/** RoundIconBtn — 시안 매칭 (2026-05-02). frosted glass 둥근 아이콘 버튼.
 *  옛 ActionPill (텍스트+아이콘 pill) 대체 — icon-only round (시안 스타일). */
function RoundIconBtn({
  icon,
  onClick,
  title,
}: {
  icon: IconName;
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
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: "rgba(0,0,0,.35)",
        backdropFilter: "blur(14px) saturate(180%)",
        WebkitBackdropFilter: "blur(14px) saturate(180%)",
        border: "1px solid rgba(255,255,255,.20)",
        boxShadow: "0 4px 12px rgba(0,0,0,.20)",
        color: "#fff",
        display: "grid",
        placeItems: "center",
      }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}
