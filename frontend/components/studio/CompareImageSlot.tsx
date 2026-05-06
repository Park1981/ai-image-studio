/**
 * CompareImageSlot — Vision Compare 페이지의 A/B 이미지 업로드 슬롯.
 * 2026-04-24 audit R3-2: StudioUploadSlot 기반으로 재작성.
 *
 * 역할:
 *   - 파일 업로드 로직 (FileReader + Image.onload) 내부 담당.
 *   - empty/filled shell · 드래그/드롭 로직은 StudioUploadSlot 위임.
 *   - filled 상태의 A/B 배지 + 2 pill (변경/해제) + 사이즈 배지 children 으로 구성.
 */

"use client";

import { useState, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import StudioUploadSlot from "@/components/studio/StudioUploadSlot";
import { loadImageFile } from "@/lib/image-actions";
import { toast } from "@/stores/useToastStore";
import type { VisionCompareImage } from "@/stores/useVisionCompareStore";

export function CompareImageSlot({
  label,
  badge,
  value,
  onChange,
  onClear,
}: {
  label: string;
  badge: "A" | "B";
  value: VisionCompareImage | null;
  onChange: (img: VisionCompareImage) => void;
  onClear: () => void;
}) {
  const [pickFn, setPickFn] = useState<(() => void) | null>(null);

  // 시안 매칭 (2026-05-03): SourceImageCard 와 통일 — 파일명/크기·형식 라벨 추출.
  const filename = value?.label || "";
  const formatExt =
    (filename.split(".").pop() || "png").toUpperCase().slice(0, 5) || "PNG";

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    try {
      const { dataUrl, width, height } = await loadImageFile(file);
      onChange({ dataUrl, label: file.name, width, height });
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "not-image") toast.error("이미지 파일만 업로드 가능합니다.");
      else if (code === "image-load-failed" || code === "image-decode-failed")
        toast.error("이미지 로드 실패");
      else toast.error("파일 읽기 실패");
    }
  };

  return (
    <StudioUploadSlot
      filled={!!value}
      height={160}
      onFiles={handleFiles}
      acceptDropWhenFilled
      // P-4: 멀티 slot(A/B) 페이지라 호버 중인 slot 만 paste 수용.
      // 둘 다 호버 없으면 Ctrl+V 무시 (충돌/모호성 방지).
      pasteEnabled
      pasteRequireHover
      onReady={(pick) => setPickFn(() => pick)}
      style={{ minHeight: 140, borderRadius: "var(--radius)" }}
      emptyContent={
        <>
          <CompareSlotBadge>{badge}</CompareSlotBadge>
          <Icon
            name="upload"
            size={20}
            style={{ color: "var(--ink-3)", marginTop: 6 }}
          />
          <div
            style={{
              fontWeight: 600,
              color: "var(--ink-2)",
              fontSize: 12,
              marginTop: 6,
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>
            클릭 또는 드래그로 업로드
          </div>
        </>
      }
    >
      {value && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.dataUrl}
            alt={label}
            style={{
              width: "100%",
              height: 160,
              objectFit: "contain",
              display: "block",
              // SourceImageCard 와 동일 — contain fallback 배경 (외곽 transparent 보완).
              background: "var(--bg-2)",
            }}
          />
          {/* A/B 배지 — Compare 고유 (보존). */}
          <CompareSlotBadge floating>{badge}</CompareSlotBadge>
          {/* 우상단 변경/해제 — SourceImageCard 와 동일 RoundIconBtn 패턴 (시안 통일 2026-05-03). */}
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              display: "flex",
              gap: 6,
            }}
          >
            <RoundIconBtn
              title="이미지 변경"
              icon="refresh"
              onClick={() => pickFn?.()}
            />
            <RoundIconBtn title="이미지 해제" icon="x" onClick={onClear} />
          </div>
          {/* 하단 파일명 + 크기·형식 — 배경 없이 텍스트 그림자만 (시안 통일 2026-05-03).
           *  SourceImageCard 와 동일 패턴이지만 padding 은 160px 슬롯에 맞춰 약간 좁게. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "8px 12px",
              color: "#fff",
              fontSize: 11,
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
            <span
              className="mono"
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,.92)",
                letterSpacing: ".04em",
                flexShrink: 0,
              }}
            >
              {value.width} × {value.height} · {formatExt}
            </span>
          </div>
        </>
      )}
    </StudioUploadSlot>
  );
}

/** RoundIconBtn — 시안 통일 (2026-05-03 · SourceImageCard 와 동일 패턴).
 *  frosted glass 둥근 아이콘 버튼 — 클릭 affordance 보존을 위해 배경 유지. */
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
        width: 28,
        height: 28,
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
      <Icon name={icon} size={12} />
    </button>
  );
}

export function CompareSlotBadge({
  children,
  floating,
}: {
  children: ReactNode;
  floating?: boolean;
}) {
  if (floating) {
    return (
      <div
        className="display"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          width: 26,
          height: 26,
          borderRadius: "var(--radius-sm)",
          background: "rgba(255,255,255,.92)",
          color: "var(--ink)",
          display: "grid",
          placeItems: "center",
          fontSize: 13,
          fontWeight: 600,
          boxShadow: "0 2px 6px rgba(0,0,0,.2)",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className="display"
      style={{
        width: 26,
        height: 26,
        borderRadius: "var(--radius-sm)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--ink-2)",
      }}
    >
      {children}
    </div>
  );
}

