"use client";

import { useRef, useState, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

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

  if (!value) {
    return (
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={() => setDrag(true)}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
        style={{
          minHeight: 140,
          border: `1.5px dashed ${drag ? "#BDB6AA" : "#D4CEC0"}`,
          borderRadius: 12,
          background: drag ? "#F1EEE8" : "var(--bg-2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          cursor: "pointer",
          color: "var(--ink-3)",
          fontSize: 12,
          padding: "16px 12px",
          transition: "all .15s",
        }}
      >
        <CompareSlotBadge>{badge}</CompareSlotBadge>
        <Icon name="upload" size={20} />
        <div style={{ fontWeight: 600, color: "var(--ink-2)" }}>{label}</div>
        <div style={{ fontSize: 11 }}>클릭 또는 드래그로 업로드</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        minHeight: 140,
        borderRadius: 12,
        background: "var(--bg-2)",
        overflow: "hidden",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
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
        <ActionPill
          onClick={() => fileInputRef.current?.click()}
          title="이미지 변경"
        >
          <Icon name="refresh" size={11} /> 변경
        </ActionPill>
        <ActionPill onClick={onClear} title="해제">
          <Icon name="x" size={11} />
        </ActionPill>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
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
    </div>
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
          borderRadius: 8,
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
        borderRadius: 8,
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
        borderRadius: 999,
      }}
    >
      {children}
    </button>
  );
}
