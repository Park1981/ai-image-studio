/**
 * SnippetLibraryModal — 라이브러리 목록 모달.
 *
 * 2026-04-30 (Phase 2B Task 6 · plan 2026-04-30-prompt-snippets-library.md · v3).
 *
 * 동작:
 *   - 카드 그리드 (썸네일 또는 📄 placeholder)
 *   - 카드 클릭 → onToggleSnippet 콜백 (부모가 textarea toggle)
 *   - 카드 [X] → confirm → remove
 *   - [+ 새 등록] → SnippetRegisterModal 띄움 (z-index 더 높게)
 *   - 빈 상태 안내
 *   - 외부 클릭 → onClose
 *   - z-index = 9997 (등록 모달 9998 < ShutdownButton 9999)
 */

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import {
  type PromptSnippet,
  usePromptSnippetsStore,
} from "@/stores/usePromptSnippetsStore";
import { hasMarker } from "@/lib/snippet-marker";
import SnippetRegisterModal from "./SnippetRegisterModal";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 현재 textarea — 카드 active 표시 + onToggle 호출 시 부모가 사용. */
  currentPrompt: string;
  onToggleSnippet: (snippet: PromptSnippet) => void;
}

export default function SnippetLibraryModal({
  open,
  onClose,
  currentPrompt,
  onToggleSnippet,
}: Props) {
  const entries = usePromptSnippetsStore((s) => s.entries);
  const remove = usePromptSnippetsStore((s) => s.remove);
  const [registerOpen, setRegisterOpen] = useState(false);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portal SSR-safe mount 가드
    setMounted(true);
  }, []);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="프롬프트 라이브러리"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9997,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "rgba(31,31,31,.28)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
        onClick={onClose}
      >
        <section
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(720px, 100%)",
            maxHeight: "calc(100vh - 48px)",
            overflowY: "auto",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            background: "var(--surface)",
            padding: 24,
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>
              📚 프롬프트 라이브러리
            </h1>
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + 새 등록
            </button>
          </div>

          {entries.length === 0 ? (
            <div
              style={{
                padding: "60px 20px",
                textAlign: "center",
                color: "var(--ink-4)",
                fontSize: 13,
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>📚</div>
              <p style={{ margin: 0 }}>라이브러리가 비어있어요.</p>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                위 [+ 새 등록] 버튼으로 첫 항목을 등록해 주세요.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 10,
              }}
            >
              {entries.map((s) => {
                const active = hasMarker(currentPrompt, s.prompt);
                return (
                  <SnippetCard
                    key={s.id}
                    snippet={s}
                    active={active}
                    onClick={() => onToggleSnippet(s)}
                    onDelete={() => {
                      if (
                        typeof window !== "undefined" &&
                        window.confirm(`"${s.name}" 항목을 삭제할까요?`)
                      ) {
                        remove(s.id);
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>

      <SnippetRegisterModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        defaultPrompt={currentPrompt}
      />
    </>,
    document.body,
  );
}

function SnippetCard({
  snippet,
  active,
  onClick,
  onDelete,
}: {
  snippet: PromptSnippet;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        border: active ? "2px solid var(--accent)" : "1px solid var(--line)",
        borderRadius: "var(--radius-sm)",
        background: active ? "rgba(74,158,255,.06)" : "var(--surface)",
        cursor: "pointer",
        overflow: "hidden",
        transition: "all .15s",
      }}
      onClick={onClick}
      title={snippet.prompt}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background: "var(--bg-2)",
          display: "grid",
          placeItems: "center",
          color: "var(--ink-4)",
          fontSize: 32,
          overflow: "hidden",
        }}
      >
        {snippet.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- base64 data URL
          <img
            src={snippet.thumbnail}
            alt={snippet.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span aria-hidden>📄</span>
        )}
      </div>

      <div
        style={{
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--ink-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={snippet.name}
        >
          {snippet.name}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="이 항목 삭제"
          style={{
            all: "unset",
            cursor: "pointer",
            width: 22,
            height: 22,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-4)",
            borderRadius: 4,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#b42318";
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(239,68,68,.08)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-4)";
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          <Icon name="x" size={11} />
        </button>
      </div>

      {active && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          ✓
        </div>
      )}
    </div>
  );
}
