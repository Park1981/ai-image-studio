/**
 * ImageLightbox - 전체화면 이미지 뷰어 + 확대/축소/드래그/더블클릭 리셋.
 *
 * 조작:
 *  - 마우스 휠: zoom in/out (커서 위치 기준)
 *  - 드래그: pan (zoom > 1 일 때)
 *  - 더블클릭: 100% ↔ 200% 토글
 *  - ESC, overlay 클릭: 닫기
 *  - +/-/0 키: zoom control
 *
 * 외부에서는 <ImageLightbox src={url} alt="..." onClose={...} /> 로 사용.
 * src 가 null 이면 렌더 안 함.
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type WheelEvent,
} from "react";
import Icon from "@/components/ui/Icon";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.15;

interface Props {
  src: string | null;
  alt?: string;
  filename?: string;
  onClose: () => void;
  /** 저장 버튼 핸들러 (옵션) */
  onDownload?: () => void;
  /** "원본으로 보내기" 핸들러 (옵션) — 연속 수정 플로우용 */
  onUseAsSource?: () => void;
}

export default function ImageLightbox(props: Props) {
  if (!props.src) return null;
  // key 로 src 변경 시 내부 state 리셋 (setState-in-effect 안티패턴 회피)
  return <LightboxInner key={props.src} {...props} />;
}

function LightboxInner({
  src,
  alt = "",
  filename,
  onClose,
  onDownload,
  onUseAsSource,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  /** ESC 키 + 숫자 key */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z + ZOOM_STEP));
      if (e.key === "-" || e.key === "_") setZoom((z) => clamp(z - ZOOM_STEP));
      if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    // 휠 네이티브 스크롤 막고 커스텀 zoom
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => clamp(z + delta));
  }, []);

  const startDrag = (e: MouseEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    e.preventDefault();
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      ox: pan.x,
      oy: pan.y,
    };
    setDragging(true);
    document.body.style.userSelect = "none";
    const move = (ev: globalThis.MouseEvent) => {
      setPan({
        x: panStart.current.ox + (ev.clientX - panStart.current.x),
        y: panStart.current.oy + (ev.clientY - panStart.current.y),
      });
    };
    const up = () => {
      setDragging(false);
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const handleDouble = () => {
    if (zoom !== 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setZoom(2);
    }
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="이미지 뷰어"
      onClick={(e) => {
        // overlay 클릭은 닫기. 내부 img 클릭은 무시.
        if (e.target === e.currentTarget) onClose();
      }}
      onWheel={handleWheel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(8, 8, 10, 0.88)",
        display: "grid",
        placeItems: "center",
        animation: "fade-in .18s ease",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {/* Top bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,.4), transparent)",
          zIndex: 2,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,.7)",
            letterSpacing: ".06em",
          }}
        >
          {filename || alt || "이미지"}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <ToolBtn
            onClick={() => setZoom((z) => clamp(z - ZOOM_STEP))}
            title="축소 (-)"
          >
            −
          </ToolBtn>
          <ToolBtn
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="원래 크기 (0)"
          >
            {Math.round(zoom * 100)}%
          </ToolBtn>
          <ToolBtn
            onClick={() => setZoom((z) => clamp(z + ZOOM_STEP))}
            title="확대 (+)"
          >
            +
          </ToolBtn>
          {onUseAsSource && (
            <ToolBtn
              onClick={() => {
                onUseAsSource();
                onClose();
              }}
              title="이 이미지를 수정 원본으로"
              accent
            >
              <Icon name="edit" size={12} />
              <span style={{ marginLeft: 5, fontSize: 11 }}>원본으로</span>
            </ToolBtn>
          )}
          {onDownload && (
            <ToolBtn onClick={onDownload} title="저장">
              <Icon name="download" size={14} />
            </ToolBtn>
          )}
          <ToolBtn onClick={onClose} title="닫기 (ESC)">
            <Icon name="x" size={14} />
          </ToolBtn>
        </div>
      </div>

      {/* Image */}
      <div
        onMouseDown={startDrag}
        onDoubleClick={handleDouble}
        style={{
          cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: dragging ? "none" : "transform .15s ease",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src ?? undefined}
          alt={alt}
          draggable={false}
          style={{
            maxWidth: "95vw",
            maxHeight: "90vh",
            objectFit: "contain",
            display: "block",
            boxShadow: "0 20px 60px rgba(0,0,0,.5)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Footer hint */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          bottom: 18,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "6px 14px",
          background: "rgba(0,0,0,.45)",
          borderRadius: 999,
          fontSize: 11,
          color: "rgba(255,255,255,.7)",
          letterSpacing: ".04em",
        }}
        className="mono"
      >
        WHEEL zoom · DRAG pan · DBL reset · ESC close
      </div>
    </div>
  );
}

function clamp(v: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v));
}

function ToolBtn({
  children,
  onClick,
  title,
  accent = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  /** accent=true 면 파란색 강조 (예: 원본으로 버튼) */
  accent?: boolean;
}) {
  const baseBg = accent ? "rgba(74,158,255,.85)" : "rgba(255,255,255,.1)";
  const hoverBg = accent ? "rgba(74,158,255,1)" : "rgba(255,255,255,.18)";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        all: "unset",
        cursor: "pointer",
        minWidth: 32,
        height: 30,
        padding: "0 10px",
        borderRadius: 8,
        background: baseBg,
        color: "rgba(255,255,255,.95)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 500,
        border: "1px solid rgba(255,255,255,.08)",
        transition: "background .15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = baseBg;
      }}
    >
      {children}
    </button>
  );
}
