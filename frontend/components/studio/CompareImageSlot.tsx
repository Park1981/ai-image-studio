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
import Icon from "@/components/ui/Icon";
import StudioUploadSlot from "@/components/studio/StudioUploadSlot";
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

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드 가능합니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        onChange({
          dataUrl,
          label: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => toast.error("이미지 로드 실패");
      img.src = dataUrl;
    };
    reader.onerror = () => toast.error("파일 읽기 실패");
    reader.readAsDataURL(file);
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
            }}
          />
          <CompareSlotBadge floating>{badge}</CompareSlotBadge>
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              display: "flex",
              gap: 6,
            }}
          >
            <ActionPill onClick={() => pickFn?.()} title="이미지 변경">
              <Icon name="refresh" size={11} /> 변경
            </ActionPill>
            <ActionPill onClick={onClear} title="해제">
              <Icon name="x" size={11} />
            </ActionPill>
          </div>
          <div
            className="mono"
            style={{
              position: "absolute",
              bottom: 6,
              left: 8,
              fontSize: 10,
              color: "rgba(255,255,255,.85)",
              background: "rgba(0,0,0,.5)",
              padding: "2px 6px",
              borderRadius: 4,
              backdropFilter: "blur(4px)",
            }}
          >
            {value.width}×{value.height}
          </div>
        </>
      )}
    </StudioUploadSlot>
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
      onClick={onClick}
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
