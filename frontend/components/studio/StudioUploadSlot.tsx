/**
 * StudioUploadSlot — 이미지 업로드 드롭존 shell 공통화 (audit R2-5).
 *
 * 기존: SourceImageCard (256px · info popover · 4 action) 와 CompareImageSlot
 *   (140px · A/B badge · 2 pill) 가 empty/drag/filled 로직을 각자 구현.
 *   → 드래그 색상, dashed border, 파일 읽기 패턴이 거의 동일한데 별개 유지.
 *
 * 이 컴포넌트 역할:
 *   - **empty/drag shell** 제공 (점선 + 드래그 색상 전환 + 파일 input 연결)
 *   - **filled shell** 제공 (surface 배경 + line border + shadow)
 *   - badge/action/popover 는 children slot 으로 받음 → variant 는 호출부가 구성
 *
 * 즉, upload 로직 공통화 + UI 차이는 호출부 자유 구성.
 *
 * 사용 예 (filled):
 *   <StudioUploadSlot filled height={256}>
 *     <img src={...} />
 *     <SizeBadge />
 *     <ActionBar />
 *   </StudioUploadSlot>
 *
 * 사용 예 (empty):
 *   <StudioUploadSlot onFiles={...} height={256} emptyContent={<UploadHint />} />
 */

"use client";

import type { CSSProperties, DragEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  /** 채워진 상태 여부. true 면 filled shell 로 렌더. */
  filled: boolean;
  /** 고정 높이 (px). empty 와 filled 가 같은 높이 유지. */
  height: number;
  /** 파일 선택/드롭 시 호출. empty shell 에서만 bind 됨 (acceptDropWhenFilled=true 이면 filled 에서도). */
  onFiles?: (files: FileList | null) => void;
  /** file input accept. 기본 image/*. */
  accept?: string;
  /** empty 상태 본문 (업로드 안내 UI). */
  emptyContent?: ReactNode;
  /** filled 상태 본문 (img + overlay 등). */
  children?: ReactNode;
  /** 변경 버튼 등으로 외부에서 file input trigger 필요 시 noop click 용 ref 콜백. */
  onReady?: (pick: () => void) => void;
  /** 내부 shell 에 추가 스타일. */
  style?: CSSProperties;
  /** filled 상태에서도 drop 이벤트를 받아 새 파일로 교체할지 여부.
   *  SourceImageCard 는 filled 일 때도 drag&drop 허용 (변경 UX). 기본 false. */
  acceptDropWhenFilled?: boolean;
}

export default function StudioUploadSlot({
  filled,
  height,
  onFiles,
  accept = "image/*",
  emptyContent,
  children,
  onReady,
  style,
  acceptDropWhenFilled = false,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  // 외부에서 trigger 필요한 경우 (filled 상태에서 변경 버튼 클릭 등)
  // render 중 ref 접근을 피하기 위해 useCallback + useEffect 패턴 사용.
  const pick = useCallback(() => fileInputRef.current?.click(), []);
  useEffect(() => {
    onReady?.(pick);
  }, [onReady, pick]);

  const common: CSSProperties = {
    position: "relative",
    width: "100%",
    height,
    borderRadius: "var(--radius-card)",
    overflow: "hidden",
    transition: "all .2s",
    ...style,
  };

  if (filled) {
    const dropHandlers = acceptDropWhenFilled
      ? {
          onDragOver: (e: DragEvent<HTMLDivElement>) => e.preventDefault(),
          onDragEnter: () => setDrag(true),
          onDragLeave: () => setDrag(false),
          onDrop: (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDrag(false);
            onFiles?.(e.dataTransfer.files);
          },
        }
      : {};
    return (
      <div
        {...dropHandlers}
        style={{
          ...common,
          background: "var(--bg-2)",
          border: drag ? "1px solid var(--accent)" : "1px solid var(--line)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        {children}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          onChange={(e) => onFiles?.(e.target.files)}
          style={{ display: "none" }}
        />
      </div>
    );
  }

  // empty
  return (
    <div
      onClick={pick}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => setDrag(true)}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles?.(e.dataTransfer.files);
      }}
      style={{
        ...common,
        background: drag ? "#F1EEE8" : "var(--bg-2)",
        border: `1.5px dashed ${drag ? "#BDB6AA" : "#D4CEC0"}`,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {emptyContent}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={(e) => onFiles?.(e.target.files)}
        style={{ display: "none" }}
      />
    </div>
  );
}
