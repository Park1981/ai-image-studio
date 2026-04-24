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
import type { HistoryItem } from "@/lib/api-client";
import { copyText } from "@/lib/image-actions";
import BeforeAfterSlider from "./BeforeAfterSlider";
import ComparisonAnalysisCard from "./ComparisonAnalysisCard";
import ComparisonAnalysisModal from "./ComparisonAnalysisModal";
import { useComparisonAnalysis } from "@/hooks/useComparisonAnalysis";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.15;
const INFO_PANEL_WIDTH = 340;

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
                borderRadius: 10,
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
          borderRadius: 999,
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

/* ─────────────────────────────────
   InfoPanel — 우측 메타정보 사이드바
   ───────────────────────────────── */
function InfoPanel({
  item,
  onClose,
}: {
  item: HistoryItem;
  onClose: (e: React.MouseEvent) => void;
}) {
  return (
    <aside
      onClick={onClose}
      // 패널 내 휠 이벤트는 상위 overlay 의 zoom 핸들러로 전파되지 않도록 차단 —
      // 패널 자체 overflowY:auto 가 정상 스크롤 담당.
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: INFO_PANEL_WIDTH,
        background: "rgba(16,16,20,.96)",
        borderLeft: "1px solid rgba(255,255,255,.08)",
        overflowY: "auto",
        padding: "60px 20px 28px",
        color: "rgba(255,255,255,.92)",
        zIndex: 3,
        boxShadow: "-8px 0 24px rgba(0,0,0,.4)",
      }}
    >
      {/* 헤더 — 프롬프트 28자 요약 (상단 타이틀) */}
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.4,
            wordBreak: "break-word",
          }}
        >
          {item.label}
        </div>
      </div>

      {/* 원본 프롬프트 */}
      <section style={{ marginBottom: 18 }}>
        <SectionTitle
          action={
            <CopyChip
              text={item.prompt}
              label="원본 프롬프트"
            />
          }
        >
          원본 프롬프트
        </SectionTitle>
        <PromptBlock text={item.prompt} />
      </section>

      {/* 업그레이드된 영문 — 있으면 */}
      {item.upgradedPrompt && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle
            action={
              <CopyChip
                text={item.upgradedPrompt}
                label="업그레이드 (영문)"
              />
            }
          >
            업그레이드 <span style={{ color: "rgba(255,255,255,.45)" }}>EN</span>
          </SectionTitle>
          <PromptBlock text={item.upgradedPrompt} />
        </section>
      )}

      {/* 한글 번역 — 있으면 */}
      {item.upgradedPromptKo && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle
            action={
              <CopyChip
                text={item.upgradedPromptKo}
                label="한글 번역"
              />
            }
          >
            한글 번역 <span style={{ color: "rgba(255,255,255,.45)" }}>KO</span>
          </SectionTitle>
          <PromptBlock text={item.upgradedPromptKo} />
        </section>
      )}

      {/* 비전 설명 (Edit 모드) */}
      {item.visionDescription && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle
            action={
              <CopyChip
                text={item.visionDescription}
                label="비전 설명"
              />
            }
          >
            비전 설명
          </SectionTitle>
          <PromptBlock text={item.visionDescription} />
        </section>
      )}

      {/* Claude 개선 힌트 */}
      {item.researchHints && item.researchHints.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle>Claude 개선 힌트</SectionTitle>
          <ul
            style={{
              listStyle: "disc",
              paddingLeft: 18,
              margin: 0,
              fontSize: 12,
              lineHeight: 1.6,
              color: "rgba(255,255,255,.82)",
            }}
          >
            {item.researchHints.map((h, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {h}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ComfyUI 에러 (Mock 폴백 시) */}
      {item.comfyError && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle>⚠ ComfyUI 오류</SectionTitle>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--amber-ink)",
              background: "rgba(250,173,20,.08)",
              border: "1px solid rgba(250,173,20,.25)",
              borderRadius: 8,
              padding: "8px 10px",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {item.comfyError}
          </div>
        </section>
      )}

      {/* 비교 분석 — Edit 모드 + 분석 결과가 있을 때만 렌더 (없으면 섹션 자체 숨김) */}
      {item.mode === "edit" && item.comparisonAnalysis && (
        <section style={{ marginBottom: 18 }}>
          <SectionTitle>비교 분석</SectionTitle>
          <ComparisonInPanel item={item} />
        </section>
      )}

      {/* ── 메타 (하단) ── 프롬프트 먼저, 참고 정보는 아래 */}
      <section
        style={{
          marginTop: 4,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,.1)",
        }}
      >
        <SectionTitle>Meta</SectionTitle>
        <MetaRow k="모델" v={item.model} />
        <MetaRow
          k="사이즈"
          v={
            item.width > 0 && item.height > 0
              ? `${item.width}×${item.height}`
              : "—"
          }
        />
        {/* video 모드 — LTX 전용 메타 (길이/FPS/프레임/빠른생성/성인모드). Step/CFG/Seed 숨김. */}
        {item.mode === "video" ? (
          <>
            {item.durationSec !== undefined && (
              <MetaRow k="길이" v={`${item.durationSec}s`} />
            )}
            {item.fps !== undefined && (
              <MetaRow k="FPS" v={<span className="mono">{item.fps}</span>} />
            )}
            {item.frameCount !== undefined && (
              <MetaRow
                k="프레임"
                v={<span className="mono">{item.frameCount}</span>}
              />
            )}
            <MetaRow
              k="빠른 생성"
              v={item.lightning ? "⚡ Lightning LoRA" : "표준"}
            />
            {item.adult !== undefined && (
              <MetaRow
                k="성인 모드"
                v={
                  item.adult ? (
                    <span style={{ color: "#ff6b9d" }}>ON</span>
                  ) : (
                    "OFF"
                  )
                }
              />
            )}
          </>
        ) : (
          <>
            <MetaRow
              k="Seed"
              v={<span className="mono">{item.seed}</span>}
            />
            <MetaRow
              k="스텝/CFG"
              v={`${item.steps} · ${item.cfg}${item.lightning ? " ⚡" : ""}`}
            />
          </>
        )}
        {item.promptProvider && (
          <MetaRow
            k="Prompt Provider"
            v={
              <span
                className="mono"
                style={{
                  color:
                    item.promptProvider === "fallback"
                      ? "var(--amber-ink)"
                      : "rgba(255,255,255,.9)",
                }}
              >
                {item.promptProvider}
              </span>
            }
          />
        )}
        <MetaRow
          k="생성일"
          v={new Date(item.createdAt).toLocaleString("ko-KR", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        />
      </section>
    </aside>
  );
}

/* ─────────────────────────────────
   ComparisonInPanel — Lightbox 내부 비교 분석 카드 + 모달
   별도 컴포넌트로 분리해 useComparisonAnalysis 훅 사용 가능
   (InfoPanel 자체는 hook 사용 위치 부적합 X)
   ───────────────────────────────── */
function ComparisonInPanel({ item }: { item: HistoryItem }) {
  // 비교 분석 훅: 분석 실행 + 진행 상태
  const { analyze, isBusy } = useComparisonAnalysis();
  // 상세 모달 열림/닫힘 state
  const [open, setOpen] = useState(false);
  return (
    <>
      <ComparisonAnalysisCard
        item={item}
        busy={isBusy(item.id)}
        onAnalyze={() => analyze(item)}
        onOpenDetail={() => setOpen(true)}
        onReanalyze={() => analyze(item)}
      />
      {/* 분석 결과 있을 때만 모달 렌더 (z-index 80 — Lightbox 70 위) */}
      {open && item.comparisonAnalysis && (
        <ComparisonAnalysisModal
          item={item}
          analysis={item.comparisonAnalysis}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8,
        gap: 8,
      }}
    >
      <h4
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,.6)",
        }}
      >
        {children}
      </h4>
      {action}
    </div>
  );
}

function MetaRow({
  k,
  v,
  copyable,
}: {
  k: string;
  v: React.ReactNode;
  copyable?: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "80px 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
        fontSize: 12,
        borderBottom: "1px solid rgba(255,255,255,.05)",
      }}
    >
      <span
        style={{
          color: "rgba(255,255,255,.5)",
          fontSize: 11,
          letterSpacing: ".02em",
        }}
      >
        {k}
      </span>
      <span style={{ color: "rgba(255,255,255,.92)", overflow: "hidden" }}>
        {v}
      </span>
      {copyable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copyText(copyable, k);
          }}
          title={`${k} 복사`}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 6,
            fontSize: 10,
            color: "rgba(255,255,255,.5)",
            border: "1px solid rgba(255,255,255,.15)",
          }}
        >
          복사
        </button>
      )}
    </div>
  );
}

function PromptBlock({ text }: { text: string }) {
  // 2026-04-24: 내부 스크롤 제거 — InfoPanel 외부 스크롤 하나로 통일 (중첩 스크롤 UX 개선).
  // 텍스트가 길면 섹션이 세로로 늘어나되 전체 흐름이 명확해짐.
  return (
    <div
      style={{
        fontSize: 12.5,
        lineHeight: 1.55,
        color: "rgba(255,255,255,.88)",
        background: "rgba(255,255,255,.04)",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: 8,
        padding: "10px 12px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </div>
  );
}

function CopyChip({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copyText(text, label);
      }}
      title={`${label} 복사`}
      style={{
        all: "unset",
        cursor: "pointer",
        fontSize: 10.5,
        padding: "3px 8px",
        borderRadius: 999,
        background: "rgba(255,255,255,.08)",
        border: "1px solid rgba(255,255,255,.12)",
        color: "rgba(255,255,255,.85)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <Icon name="copy" size={10} />
      복사
    </button>
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
