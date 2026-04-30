/**
 * SnippetLibraryModal — 프롬프트 라이브러리 Drawer (수정/삭제 통합).
 *
 * 2026-04-30 (drawer 디자인 통일 — Edit 의 ReferenceLibraryDrawer 패턴 따라감 · 옵션 B).
 *
 * 동작:
 *   - 우측 Drawer (480px) · overlay 클릭 / ESC / [×] 로 닫기
 *   - 카드 그리드 (2열) · 썸네일 140px · 이름 + prompt 미리보기
 *   - 카드 클릭 → onToggleSnippet (라이브러리 픽 = textarea 단일 활성)
 *   - 카드 우상단 [✎] 수정 / [×] 삭제
 *   - 카드 좌상단 ✓ — 현재 textarea 에 active 인 카드 표시
 *   - 헤더 [+ 새 등록] 버튼
 *   - 빈 상태 dashed 안내
 *   - z-index 9997 (등록/수정 모달 9998 < ShutdownButton 9999)
 *
 * 컴포넌트 이름은 Modal 그대로 유지 (역사적 + import 호환). 형태만 Drawer.
 */

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import { hasMarker } from "@/lib/snippet-marker";
import {
  type PromptSnippet,
  usePromptSnippetsStore,
} from "@/stores/usePromptSnippetsStore";
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

  // 등록/수정 통합 모달 — modalMode null 이면 닫힘.
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [modalTarget, setModalTarget] = useState<PromptSnippet | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portal SSR-safe mount 가드
    setMounted(true);
  }, []);

  // ESC = Drawer 닫기 (sub-modal 열려있으면 그쪽 ESC 가 우선 — 동시 닫힘 자연스러움)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && modalMode === null) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, modalMode]);

  if (!mounted || !open) return null;

  const handleDelete = (s: PromptSnippet) => {
    if (
      typeof window !== "undefined" &&
      window.confirm(`"${s.name}" 항목을 삭제할까요?`)
    ) {
      remove(s.id);
    }
  };

  return createPortal(
    <>
      {/* Overlay — 클릭 시 닫힘 (Edit Drawer 와 동일 톤) */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(23,20,14,.32)",
          zIndex: 9996,
        }}
      />
      {/* Drawer 본체 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="프롬프트 라이브러리"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: "100vw",
          background: "var(--bg)",
          borderLeft: "1px solid var(--line)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 9997,
          display: "flex",
          flexDirection: "column",
          padding: "20px 24px",
          gap: 14,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--ink)",
              margin: 0,
            }}
          >
            📚 프롬프트 라이브러리
          </h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => {
                setModalTarget(null);
                setModalMode("create");
              }}
              style={{
                height: 28,
                padding: "0 10px",
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
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              style={{
                all: "unset",
                cursor: "pointer",
                fontSize: 18,
                color: "var(--ink-3)",
                padding: "4px 8px",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {entries.length === 0 ? (
          <div
            style={{
              padding: "30px 20px",
              textAlign: "center",
              fontSize: 12.5,
              color: "var(--ink-4)",
              border: "1px dashed var(--line-2, var(--line))",
              borderRadius: "var(--radius)",
            }}
          >
            저장된 프롬프트가 없어요.
            <br />위 [+ 새 등록] 버튼으로 첫 항목을 등록해 주세요.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
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
                  onPick={() => onToggleSnippet(s)}
                  onEdit={() => {
                    setModalTarget(s);
                    setModalMode("edit");
                  }}
                  onDelete={() => handleDelete(s)}
                />
              );
            })}
          </div>
        )}
      </aside>

      {/* 등록/수정 통합 모달 — modalMode 에 따라 mode/editTarget 다르게 */}
      <SnippetRegisterModal
        open={modalMode !== null}
        mode={modalMode ?? "create"}
        editTarget={modalTarget ?? undefined}
        defaultPrompt={currentPrompt}
        onClose={() => {
          setModalMode(null);
          setModalTarget(null);
        }}
      />
    </>,
    document.body,
  );
}

/* ── 카드 ── */

function SnippetCard({
  snippet,
  active,
  onPick,
  onEdit,
  onDelete,
}: {
  snippet: PromptSnippet;
  active: boolean;
  onPick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      title={snippet.prompt}
      style={{
        position: "relative",
        background: "var(--surface)",
        border: active ? "2px solid var(--accent)" : "1px solid var(--line)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color .15s",
      }}
    >
      {/* 썸네일 */}
      <div
        style={{
          width: "100%",
          height: 140,
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
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <span aria-hidden>📄</span>
        )}
      </div>

      {/* 이름 + 프롬프트 미리보기 */}
      <div style={{ padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {snippet.name}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--ink-3)",
            marginTop: 4,
            lineHeight: 1.4,
            maxHeight: 28,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {snippet.prompt}
        </div>
      </div>

      {/* 우상단 액션: [✎] [×] — Edit drawer 와 통일된 검정 반투명 원형 */}
      <div
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "flex",
          gap: 4,
        }}
      >
        <CardActionBtn
          iconName="edit"
          label="수정"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        />
        <CardActionBtn
          iconName="x"
          label="삭제"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        />
      </div>

      {/* 좌상단 active ✓ — 옛 우상단에서 위치 변경 (액션 버튼과 충돌 방지) */}
      {active && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            left: 6,
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

function CardActionBtn({
  iconName,
  label,
  onClick,
}: {
  iconName: "edit" | "x";
  label: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: "rgba(0,0,0,.55)",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        padding: 0,
      }}
    >
      <Icon name={iconName} size={11} />
    </button>
  );
}
