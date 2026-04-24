/**
 * ResultInfoModal — 결과 상세 정보 중앙 모달 (애플 액션시트 스타일).
 * 2026-04-24 · 결과 영역 UX v2.
 *
 * 동작:
 *  - open=true 마운트 시 스프링 애니메이션으로 등장 (scale + translateY + opacity)
 *  - 닫기: × 버튼 / ESC / 바깥(backdrop) 클릭
 *  - 내부 스크롤 지원 (최대 높이 70vh)
 *  - 4 메뉴 공용 — children 으로 각 메뉴별 내용 주입
 *
 * 키보드 접근성: ESC 로 닫기. Tab 포커스는 모달 내부만 (trap) 은 미구현 (1차 생략).
 */

"use client";

import { useEffect, type ReactNode } from "react";
import Icon from "@/components/ui/Icon";

interface Props {
  open: boolean;
  /** 모달 상단 라벨 — 없으면 헤더 생략 */
  title?: string;
  onClose: () => void;
  children: ReactNode;
}

export default function ResultInfoModal({ open, title, onClose, children }: Props) {
  // ESC 로 닫기 — open 일 때만 리스너 등록
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      // backdrop — 바깥 클릭 시 닫힘
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        // fade-in 애니메이션 (globals.css 의 @keyframes fade-in 재사용)
        animation: "fade-in .18s ease-out",
      }}
    >
      {/* 모달 카드 — 이벤트 버블 차단 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          color: "var(--ink)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 20px 60px rgba(0,0,0,.35), 0 8px 20px rgba(0,0,0,.18)",
          border: "1px solid var(--line)",
          width: "100%",
          maxWidth: 640,
          maxHeight: "min(70vh, 720px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          // 애플 시트 스프링 — overshoot cubic-bezier 로 약간 튕김
          animation:
            "result-modal-in .28s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {title && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderBottom: "1px solid var(--line)",
              flexShrink: 0,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 13.5,
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: 0,
              }}
            >
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              title="닫기 (ESC)"
              style={{
                all: "unset",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                width: 28,
                height: 28,
                borderRadius: "var(--radius-sm)",
                color: "var(--ink-3)",
                transition: "background .12s, color .12s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--bg-2)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--ink)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-3)";
              }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        )}

        {/* 본문 — 내용이 길면 내부 스크롤 */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "18px 20px 20px",
          }}
        >
          {children}
        </div>
      </div>

      {/* 인라인 키프레임 — globals.css 수정 없이 컴포넌트 스코프 내부에서 정의 */}
      <style>{`
        @keyframes result-modal-in {
          from {
            opacity: 0;
            transform: scale(0.92) translateY(16px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
