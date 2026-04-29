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
import type { HistoryItem } from "@/lib/api/types";
import BeforeAfterSlider from "./BeforeAfterSlider";
// 2026-04-27 (C2-P1-2): InfoPanel 분해 — sub-component 들 lightbox/InfoPanel.tsx 로 이전.
import InfoPanel, { INFO_PANEL_WIDTH } from "./lightbox/InfoPanel";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.15;

/** 비디오 확장자 판별 (mp4/webm/mov/data:video/mock-seed://video) */
function isVideoSrc(src: string): boolean {
  if (src.startsWith("data:video/")) return true;
  if (src.startsWith("mock-seed://video")) return true;
  const clean = src.split(/[?#]/)[0].toLowerCase();
  return (
    clean.endsWith(".mp4") ||
    clean.endsWith(".webm") ||
    clean.endsWith(".mov")
  );
}

/** mock 영상 sentinel 여부 */
function isMockVideoSrc(src: string | null): boolean {
  return !!src && src.startsWith("mock-seed://video");
}

interface Props {
  src: string | null;
  alt?: string;
  filename?: string;
  onClose: () => void;
  /** 저장 버튼 핸들러 (옵션) */
  onDownload?: () => void;
  /** "원본으로 보내기" 핸들러 (옵션) — 연속 수정 플로우용 */
  onUseAsSource?: () => void;
  /**
   * 2026-04-24: 메타정보(프롬프트/seed/steps/model/...) 표시용.
   * 있으면 우측 340px 정보 패널 렌더. 없으면 기존 단순 뷰어.
   */
  item?: HistoryItem;
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
  item,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const isVideo = src ? isVideoSrc(src) : false;

  /* ── Before/After 비교 토글 (2차) ──
     canCompare: edit 모드 + sourceRef 있을 때만 활성.
     compareMode ON 시 이미지 영역을 BeforeAfterSlider 로 교체 + zoom/pan 컨트롤 숨김. */
  const canCompare =
    !isVideo && item?.mode === "edit" && !!item?.sourceRef;
  const [compareMode, setCompareMode] = useState(false);

  /** ESC 키 + 숫자 key + B(비교 토글) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z + ZOOM_STEP));
      if (e.key === "-" || e.key === "_") setZoom((z) => clamp(z - ZOOM_STEP));
      if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      // B: Before/After 비교 토글 (canCompare 일 때만)
      if ((e.key === "b" || e.key === "B") && canCompare) {
        setCompareMode((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, canCompare]);

  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      // 비디오·비교 모드는 줌/팬 비활성 — 각각 컨트롤/슬라이더 드래그로 제공
      if (isVideo || compareMode) return;
      // 휠 네이티브 스크롤 막고 커스텀 zoom
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((z) => clamp(z + delta));
    },
    [isVideo, compareMode],
  );

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
      // 2026-04-29: backdrop (빈 곳) 클릭 닫힘 비활성화 — 명시적 닫기 (X 버튼) 또는 ESC 키만 닫힘.
      // 옛 동작: overlay 클릭 시 onClose() — 슬라이더 드래그 중 실수로 빈 영역 놓치면 닫혀버리는 문제.
      onWheel={handleWheel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(8, 8, 10, 0.88)",
        display: "grid",
        placeItems: "center",
        // 정보 패널 있으면 이미지 영역이 패널에 안 가리도록 우측 padding
        paddingRight: item ? INFO_PANEL_WIDTH : 0,
        animation: "fade-in .18s ease",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {/* Top bar — 정보 패널에 가리지 않도록 우측 끝을 패널 경계로 제한 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: item ? INFO_PANEL_WIDTH : 0,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,.4), transparent)",
          zIndex: 4, // 패널(3)보다 위 — 탑바가 확실히 클릭 받게
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
          {/* zoom 컨트롤 — 비디오 또는 비교 모드일 땐 비활성 */}
          {!isVideo && !compareMode && (
            <>
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
            </>
          )}
          {/* Before/After 비교 토글 — edit + sourceRef 있을 때만 */}
          {canCompare && (
            <ToolBtn
              onClick={() => setCompareMode((v) => !v)}
              accent={compareMode}
              title="Before/After 비교 (B)"
            >
              <span style={{ fontSize: 13, lineHeight: 1 }}>↔</span>
              <span style={{ marginLeft: 5, fontSize: 11 }}>
                {compareMode ? "비교 해제" : "비교"}
              </span>
            </ToolBtn>
          )}
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

      {/* Media — 비디오면 <video controls>, 아니면 확대/팬 가능한 <img> */}
      {isVideo ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "grid",
            placeItems: "center",
            maxWidth: "95vw",
            maxHeight: "90vh",
          }}
        >
          {isMockVideoSrc(src) ? (
            <div
              style={{
                width: "min(560px, 80vw)",
                padding: "44px 28px",
                background: "rgba(255,255,255,.06)",
                border: "1px dashed rgba(255,255,255,.2)",
                borderRadius: "var(--radius)",
                textAlign: "center",
                color: "rgba(255,255,255,.85)",
                fontSize: 13.5,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                Mock 영상 (실 mp4 없음)
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,.6)" }}>
                실제 재생을 보려면 백엔드 연결 (NEXT_PUBLIC_USE_MOCK=false) 후
                <br />
                다시 생성해 주세요.
              </div>
            </div>
          ) : (
            <video
              src={src ?? undefined}
              controls
              autoPlay
              loop
              playsInline
              style={{
                maxWidth: "95vw",
                maxHeight: "90vh",
                display: "block",
                // audit R1-3: 미디어 뷰어 레터박스 배경 토큰화 (기능적으로 어두워야 함 · 토큰으로만 봉인)
                background: "var(--bg-dark)",
                borderRadius: 4,
                boxShadow: "0 20px 60px rgba(0,0,0,.5)",
              }}
            />
          )}
        </div>
      ) : compareMode && canCompare ? (
        // 비교 모드 — BeforeAfterSlider 로 이미지 영역 교체. zoom/pan 비활성.
        // wrapper 는 flex+center 로 슬라이더 자체를 가운데 정렬 (/edit 페이지와 동일 패턴).
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: `min(95vw${item ? ` - ${INFO_PANEL_WIDTH}px` : ""}, ${item?.width ?? 1600}px)`,
            maxHeight: "90vh",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <BeforeAfterSlider
            beforeSrc={item!.sourceRef!}
            afterSeed={src ?? item!.imageRef}
            aspectRatio={`${item!.width} / ${item!.height}`}
            maxHeight="90vh"
            // 2026-04-29: Edit 메인 뷰어와 동일 정합 fix —
            // 컨테이너 = After 비율, Before 는 cover 로 풀필 (좌우 인물 위치 일치)
            beforeFit="cover"
          />
        </div>
      ) : (
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
      )}

      {/* Footer hint — 정보 패널 있을 땐 좌측 기준 정렬 (패널에 겹치지 않게) */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          bottom: 18,
          left: item
            ? `calc((100% - ${INFO_PANEL_WIDTH}px) / 2)`
            : "50%",
          transform: "translateX(-50%)",
          padding: "6px 14px",
          // audit R1-3: 오버레이 pill 배경 토큰화
          background: "var(--overlay-dark)",
          borderRadius: "var(--radius-full)",
          fontSize: 11,
          color: "rgba(255,255,255,.7)",
          letterSpacing: ".04em",
        }}
        className="mono"
      >
        {isVideo
          ? "SPACE play/pause · ESC close"
          : compareMode
            ? "↔ DRAG 비교 · B 토글 · ESC close"
            : `WHEEL zoom · DRAG pan · DBL reset${canCompare ? " · B 비교" : ""} · ESC close`}
      </div>

      {/* Info Panel — item 전달된 경우만 렌더 */}
      {item && <InfoPanel item={item} onClose={(e) => e.stopPropagation()} />}
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
        borderRadius: "var(--radius-sm)",
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
