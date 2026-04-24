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
 *   - **2026-04-25 paste 기능 (P-2)**: 전역 Ctrl+V 로 클립보드 이미지 업로드.
 *     focus 가드 (TEXTAREA/INPUT/contentEditable) 로 textarea 텍스트 paste
 *     와 충돌 방지. 멀티 slot 페이지에서는 pasteRequireHover 로 호버 slot
 *     만 응답.
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
 *
 * 사용 예 (paste):
 *   <StudioUploadSlot pasteEnabled onFiles={...} ... />        // 단일 slot
 *   <StudioUploadSlot pasteEnabled pasteRequireHover ... />    // 멀티 slot
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
  /** 전역 Ctrl+V paste 수용 여부 (2026-04-25 P-2).
   *  true 면 document-level paste 리스너 등록. TEXTAREA/INPUT/contentEditable
   *  에 focus 있을 때는 자동 skip (텍스트 paste 보존). 기본 false. */
  pasteEnabled?: boolean;
  /** paste 가 호버 중일 때만 발화해야 할지 (멀티 slot 페이지 용).
   *  Compare 페이지처럼 여러 slot 이 공존하면 호버 slot 만 응답해 충돌 방지.
   *  단일 slot 페이지 (edit/video/vision) 는 기본 false — 호버 무관 수용.
   *  기본 false. */
  pasteRequireHover?: boolean;
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
  pasteEnabled = false,
  pasteRequireHover = false,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState(false);

  // 외부에서 trigger 필요한 경우 (filled 상태에서 변경 버튼 클릭 등)
  // render 중 ref 접근을 피하기 위해 useCallback + useEffect 패턴 사용.
  const pick = useCallback(() => fileInputRef.current?.click(), []);
  useEffect(() => {
    onReady?.(pick);
  }, [onReady, pick]);

  // 최신 상태를 ref 에 보관 — paste listener 는 1회 등록 후 재등록 비용 줄이기.
  // (closure 캡처 이슈 회피). useEffect 에서 동기화 (render-time ref 쓰기 회피).
  const hoverRef = useRef(hover);
  const requireHoverRef = useRef(pasteRequireHover);
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);
  useEffect(() => {
    requireHoverRef.current = pasteRequireHover;
  }, [pasteRequireHover]);
  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  // ── P-2: 전역 Ctrl+V paste 리스너 ──
  useEffect(() => {
    if (!pasteEnabled) return;
    const handler = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const activeIsInput =
        !!active &&
        (active.tagName === "TEXTAREA" ||
          active.tagName === "INPUT" ||
          active.isContentEditable);

      // 가드 정책 (Compare 버그 fix 2026-04-25):
      //   - 단일 slot (pasteRequireHover=false): focus 가드 필수.
      //     textarea 에서 Ctrl+V 하면 텍스트 paste 가 정답 → 이미지 로직 skip.
      //   - 멀티 slot (pasteRequireHover=true): 호버 자체가 명시적 의도.
      //     textarea 에 이전 focus 가 남아 있어도 slot 호버 + Ctrl+V 면 업로드.
      //     (텍스트 paste 는 브라우저 기본 동작으로 textarea 에 먼저 들어가고,
      //      우리 리스너는 bubble 단계에서 이미지만 처리 — 충돌 없음.)
      if (requireHoverRef.current) {
        // 호버 중인 slot 만 응답. 호버 없으면 무시.
        if (!hoverRef.current) return;
      } else {
        // 단일 slot 모드: textarea/input focus 시 skip.
        if (activeIsInput) return;
      }

      // 클립보드에서 이미지 추출.
      const items = e.clipboardData?.items;
      if (!items) return;
      let imageItem: DataTransferItem | null = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          imageItem = items[i];
          break;
        }
      }
      if (!imageItem) return;

      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;

      // onFiles 시그니처는 FileList. DataTransfer 로 흉내.
      const dt = new DataTransfer();
      dt.items.add(file);
      onFilesRef.current?.(dt.files);
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [pasteEnabled]);

  const common: CSSProperties = {
    position: "relative",
    width: "100%",
    height,
    borderRadius: "var(--radius-card)",
    overflow: "hidden",
    transition: "all .2s",
    ...style,
  };

  // 호버 추적 핸들러 (pasteRequireHover 일 때만 효과 있음. 항상 달아도 부담 없음)
  const hoverHandlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
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
        {...hoverHandlers}
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
      {...hoverHandlers}
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
      {/* P-5: paste 힌트 — 호버 중일 때만 표시 (비호버 시 잡음 최소화).
       *   pasteRequireHover 여부 무관하게 "붙여넣기 가능" 만 알림. */}
      {pasteEnabled && hover && (
        <div
          style={{
            marginTop: 8,
            fontSize: 10.5,
            color: "var(--ink-4)",
            letterSpacing: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          또는 <kbd style={kbdStyle}>Ctrl</kbd>
          <span style={{ opacity: 0.6 }}>+</span>
          <kbd style={kbdStyle}>V</kbd> 로 붙여넣기
        </div>
      )}
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

const kbdStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  padding: "1px 5px",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  color: "var(--ink-3)",
  lineHeight: 1.2,
};
