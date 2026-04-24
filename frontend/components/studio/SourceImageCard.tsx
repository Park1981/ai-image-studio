/**
 * SourceImageCard — Edit 페이지의 원본 이미지 카드 (드롭존 + 오버레이 + 팝오버).
 * 2026-04-23 Opus F5: edit/page.tsx 에서 분리 (~216줄 → 별도 컴포넌트).
 *
 * 상태:
 *   - 빈 상태: 업로드 유도 dropzone
 *   - 채워진 상태: contain 풀커버 이미지 + 4 오버레이 (ⓘ 팝오버 · × 해제 ·
 *     사이즈배지 좌하 · 변경 버튼 우하)
 *
 * 책임 경계:
 *   - 파일 업로드 (FileReader + Image.onload 로 크기 추출) 내부에서 처리.
 *   - onChange(image, label, w, h) 로 부모에 세 값 동시 전달.
 *   - × 해제는 onClear() 단일 콜백 — 부모가 setSource(null) + 토스트 처리.
 *
 * 에러:
 *   - 이미지 아닌 파일, 로드 실패 시 onError(message) 호출 — 부모가 토스트 판단.
 */

"use client";

import { useRef, useState } from "react";
import Icon from "@/components/ui/Icon";

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
}

export default function SourceImageCard({
  sourceImage,
  sourceLabel,
  sourceWidth,
  sourceHeight,
  onChange,
  onClear,
  onError,
}: SourceImageCardProps) {
  const [drag, setDrag] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      {/* 메인 카드 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => {
          if (!sourceImage) fileInputRef.current?.click();
        }}
        style={{
          position: "relative",
          height: 256,
          borderRadius: "var(--radius-card)",
          overflow: "hidden",
          background: sourceImage
            ? "var(--bg-2)"
            : drag
              ? "#F1EEE8"
              : "var(--bg-2)",
          border: sourceImage
            ? "1px solid var(--line)"
            : `1.5px dashed ${drag ? "#BDB6AA" : "#D4CEC0"}`,
          transition: "all .2s",
          cursor: sourceImage ? "default" : "pointer",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: "none" }}
        />

        {sourceImage ? (
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
                // 레터박스 배경을 warm neutral 로 통일 (audit 2026-04-24 P0-1).
                // 기존 "#111" 은 다른 메뉴의 CompareImageSlot / VisionResultCard 와
                // 톤이 어긋나 업로드 이미지가 메뉴마다 다른 앱처럼 보이던 문제.
                background: "var(--bg-2)",
              }}
            />
            {/* 하단 그라디언트 — 배지/버튼 가독성 보장용 (유지).
             *   warm neutral 배경에서도 흰색 텍스트 pill 의 대비 확보 필요.
             *   다만 강도를 .55 → .42 로 낮춰 톤 이질감 감소. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(to top, rgba(0,0,0,.42) 0%, transparent 55%)",
                pointerEvents: "none",
              }}
            />
            {/* 사이즈 배지 */}
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
            {/* 변경 버튼 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              style={{
                position: "absolute",
                bottom: 8,
                right: 8,
                fontSize: 10,
                color: "rgba(255,255,255,.8)",
                background: "rgba(0,0,0,.35)",
                border: "none",
                borderRadius: 4,
                padding: "2px 7px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              변경
            </button>
            {/* ⓘ 상세 */}
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
            {/* × 해제 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "rgba(0,0,0,.4)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
              }}
              title="이미지 해제"
            >
              <Icon name="x" size={10} />
            </button>
          </>
        ) : (
          /* 빈 상태 */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 8,
              color: "var(--ink-4)",
            }}
          >
            <Icon name="upload" size={22} />
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--ink-3)",
              }}
            >
              드래그 또는 클릭
            </div>
            <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
              PNG · JPG · WebP
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
