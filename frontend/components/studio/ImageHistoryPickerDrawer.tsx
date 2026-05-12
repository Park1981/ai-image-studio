/**
 * ImageHistoryPickerDrawer — 이미지 원본 선택용 히스토리 드로어.
 *
 * Edit / Video 의 "원본 이미지" 슬롯에서 공통 사용한다.
 * Generate/Edit 결과 이미지만 표시하고, 선택 즉시 호출부가 source 로 적용한다.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import ImageTile from "@/components/ui/ImageTile";
import { SegControl } from "@/components/ui/primitives";
import type { HistoryItem, HistoryMode } from "@/lib/api/types";

type ImageHistoryFilter = "all" | Extract<HistoryMode, "generate" | "edit">;

interface Props {
  open: boolean;
  onClose: () => void;
  items: HistoryItem[];
  selectedImageRef?: string | null;
  title?: string;
  description?: string;
  onPick: (item: HistoryItem) => void;
}

const IMAGE_HISTORY_MODES = new Set<HistoryMode>(["generate", "edit"]);

export default function ImageHistoryPickerDrawer({
  open,
  onClose,
  items,
  selectedImageRef,
  title = "원본 이미지 선택",
  description = "생성/수정 히스토리에서 원본으로 사용할 이미지를 고릅니다.",
  onPick,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<ImageHistoryFilter>("all");
  const [nowMs] = useState(() => Date.now());
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portal SSR-safe mount guard.
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    const timer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  const imageItems = useMemo(
    () =>
      items
        .filter((it) => IMAGE_HISTORY_MODES.has(it.mode))
        .sort((a, b) => b.createdAt - a.createdAt),
    [items],
  );

  const counts = useMemo(
    () => ({
      all: imageItems.length,
      generate: imageItems.filter((it) => it.mode === "generate").length,
      edit: imageItems.filter((it) => it.mode === "edit").length,
    }),
    [imageItems],
  );

  const visibleItems = useMemo(
    () =>
      filter === "all"
        ? imageItems
        : imageItems.filter((it) => it.mode === filter),
    [filter, imageItems],
  );

  if (!mounted || !open) return null;

  const handlePick = (item: HistoryItem) => {
    onPick(item);
    onClose();
  };

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(23,20,14,.32)",
          zIndex: 9996,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 520,
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
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 16,
                fontWeight: 700,
                color: "var(--ink)",
                margin: 0,
              }}
            >
              <Icon name="image" size={16} />
              {title}
            </h2>
            <p
              style={{
                margin: "5px 0 0",
                fontSize: 11.5,
                color: "var(--ink-4)",
              }}
            >
              {description}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--ink-3)",
              padding: "4px 8px",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <SegControl
            value={filter}
            onChange={(v) => setFilter(v as ImageHistoryFilter)}
            options={[
              { value: "all", label: `전체 ${counts.all}` },
              { value: "generate", label: `생성 ${counts.generate}` },
              { value: "edit", label: `수정 ${counts.edit}` },
            ]}
          />
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              color: "var(--ink-4)",
              letterSpacing: ".03em",
            }}
          >
            NEWEST FIRST
          </span>
        </div>

        {visibleItems.length === 0 ? (
          <div
            style={{
              padding: "34px 20px",
              textAlign: "center",
              fontSize: 12.5,
              color: "var(--ink-4)",
              border: "1px dashed var(--line-2, var(--line))",
              borderRadius: "var(--radius)",
            }}
          >
            선택할 이미지 히스토리가 없어요.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {visibleItems.map((item) => (
              <ImageHistoryCard
                key={item.id}
                item={item}
                selected={item.imageRef === selectedImageRef}
                nowMs={nowMs}
                onPick={() => handlePick(item)}
              />
            ))}
          </div>
        )}
      </aside>
    </>,
    document.body,
  );
}

function ImageHistoryCard({
  item,
  selected,
  nowMs,
  onPick,
}: {
  item: HistoryItem;
  selected: boolean;
  nowMs: number;
  onPick: () => void;
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
      title={item.prompt}
      style={{
        position: "relative",
        background: "var(--surface)",
        border: selected ? "2px solid var(--accent)" : "1px solid var(--line)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color .15s, transform .15s",
      }}
    >
      <ImageTile
        seed={item.imageRef || item.id}
        aspect="4 / 3"
        style={{
          width: "100%",
          borderRadius: 0,
          background: "var(--bg-2)",
        }}
      />
      <div style={{ padding: "8px 10px 10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.label}
          </span>
          <span
            className="mono"
            style={{
              flexShrink: 0,
              fontSize: 10,
              color: item.mode === "edit" ? "var(--amber-ink)" : "var(--accent-ink)",
              background:
                item.mode === "edit" ? "var(--amber-soft)" : "var(--accent-soft)",
              borderRadius: "var(--radius-full)",
              padding: "2px 6px",
            }}
          >
            {item.mode === "edit" ? "EDIT" : "GEN"}
          </span>
        </div>
        <div
          className="mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 5,
            fontSize: 10.5,
            color: "var(--ink-4)",
          }}
        >
          <span>{item.width}×{item.height}</span>
          <span>·</span>
          <span>{formatDrawerDate(item.createdAt, nowMs)}</span>
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--ink-3)",
            marginTop: 5,
            lineHeight: 1.4,
            minHeight: 29,
            maxHeight: 29,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {item.prompt || "프롬프트 없음"}
        </div>
      </div>
      {selected && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,.22)",
          }}
        >
          <Icon name="check" size={13} stroke={2.4} />
        </div>
      )}
    </div>
  );
}

function formatDrawerDate(ms: number, nowMs: number): string {
  const date = new Date(ms);
  const now = new Date(nowMs);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  if (date.getFullYear() === now.getFullYear()) {
    return `${mm}.${dd}`;
  }
  return `${date.getFullYear()}.${mm}.${dd}`;
}
