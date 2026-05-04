/**
 * VideoSizeWarnModal - 영상 출력 사이즈가 임계 (W or H ≥ 1280, 또는 W&H 둘 다 ≥ 1000) 충족 시
 * Render 클릭 후 사용자에게 한 번 더 확인을 받는 경고 모달.
 *
 * spec: docs/superpowers/specs/2026-05-04-video-size-warn-modal-design.md (v1.4)
 *
 * VideoLeftPanel 의 handleCtaClick 에서:
 *   1. shouldWarnVideoSize(expected.W, expected.H) 충족 시 open=true
 *   2. 사용자가 [그대로 진행] 누르면 → setWarnOpen(false) → onGenerate()
 *   3. [취소] / ESC / overlay 클릭 → setWarnOpen(false) (생성 중단, 사용자가 좌측 슬라이더로 변경)
 *
 * shell 패턴: UpgradeConfirmModal.tsx 동일 (dialog role + zIndex 65 + design tokens).
 *
 * 아이콘: "alert" 이 IconName union 에 없으므로 "bolt" 사용 (경고 맥락 가장 근접).
 * "flame" 은 Video 성인 모드에 이미 매핑되어 있어 제외.
 */

"use client";

import { useEffect } from "react";

import Icon from "@/components/ui/Icon";
import { simplifyRatio } from "@/lib/video-size";

interface Props {
  open: boolean;
  /** 출력 예상 가로 (px) — VideoLeftPanel 의 expected.width 가 단일 진실원. */
  width: number;
  /** 출력 예상 세로 (px) — VideoLeftPanel 의 expected.height. */
  height: number;
  /** [취소] / ESC / overlay 클릭. */
  onCancel: () => void;
  /** [그대로 진행]. */
  onConfirm: () => void;
}

export default function VideoSizeWarnModal({
  open,
  width,
  height,
  onCancel,
  onConfirm,
}: Props) {
  // ESC = cancel. open=false 시 listener 미등록 + open 변경/unmount 시 cleanup (UpgradeConfirmModal:77-84 패턴).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  // 비율 표시 — simplifyRatio 가 bad input 시 "-" 반환
  const ratio = simplifyRatio(width, height);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="영상 사이즈 확인"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 65,
        background: "rgba(23, 20, 14, 0.42)",
        display: "grid",
        placeItems: "center",
        animation: "fade-in .18s ease",
        padding: 20,
      }}
      // overlay 클릭만 닫힘 (모달 내부 클릭은 가로채지 않게 currentTarget 체크).
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <section
        style={{
          background: "var(--bg)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--line)",
          width: "min(440px, 100%)",
          // overflow: hidden — footer 의 var(--bg-2) 배경이 둥근 모서리 따라가게.
          // (UpgradeConfirmModal:117 패턴 미러)
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              minWidth: 0,
            }}
          >
            {/* bolt = 경고 맥락. alert 이 union 에 없어서 대체 사용. */}
            <Icon name="bolt" size={14} />
            <h2
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: 0,
              }}
            >
              큰 사이즈로 생성할까요?
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            style={{
              all: "unset",
              cursor: "pointer",
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              display: "grid",
              placeItems: "center",
              color: "var(--ink-3)",
            }}
            title="취소 (ESC)"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        {/* Body */}
        <div
          style={{
            padding: "16px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.6,
            }}
          >
            현재 컴퓨터 제원에서는 생성 시간이 오래 걸리거나 중간에 중단될 수
            있어요.
          </p>
          {/* 출력 사이즈 + 비율 표시 박스 */}
          <div
            style={{
              padding: "10px 12px",
              background: "var(--bg-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}
          >
            출력{" "}
            <span
              className="mono"
              style={{ color: "var(--accent-ink)", fontWeight: 600 }}
            >
              {width}×{height}
            </span>{" "}
            <span style={{ color: "var(--ink-4)" }}>· {ratio}</span>
          </div>
        </div>

        {/* Footer */}
        <footer
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            background: "var(--bg-2)",
          }}
        >
          {/* 취소 — secondary 스타일 (UpgradeConfirmModal secondaryBtnStyle 패턴) */}
          <button
            type="button"
            onClick={onCancel}
            style={{
              all: "unset",
              padding: "8px 14px",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface)",
              color: "var(--ink-2)",
              border: "1px solid var(--line)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            취소
          </button>
          {/* 그대로 진행 — primary 스타일 (UpgradeConfirmModal primaryBtnStyle 패턴) */}
          <button
            type="button"
            onClick={onConfirm}
            style={{
              all: "unset",
              padding: "8px 16px",
              borderRadius: "var(--radius-sm)",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0,
              boxShadow: "0 2px 8px rgba(74,158,255,.28)",
              cursor: "pointer",
            }}
          >
            그대로 진행
          </button>
        </footer>
      </section>
    </div>
  );
}
