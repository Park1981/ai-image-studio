/**
 * HistoryPicker — Edit 페이지에서 과거 생성/수정 결과를 원본으로 재사용.
 * 2026-04-23 Opus F5: edit/page.tsx 에서 분리 (~63줄 → 별도 컴포넌트).
 *
 * open prop 으로 표시/숨김. 최대 16개 썸네일 그리드 (4-col).
 */

"use client";

import type { HistoryItem } from "@/lib/api-client";
import ImageTile from "@/components/ui/ImageTile";

interface HistoryPickerProps {
  open: boolean;
  items: HistoryItem[];
  /** 썸네일 클릭 시 호출 — 부모가 setSource + 픽커 닫기 처리 */
  onSelect: (item: HistoryItem) => void;
}

export default function HistoryPicker({
  open,
  items,
  onSelect,
}: HistoryPickerProps) {
  if (!open) return null;
  return (
    <div
      style={{
        marginBottom: 10,
        padding: 10,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        maxHeight: 220,
        overflowY: "auto",
      }}
    >
      {items.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-4)",
            textAlign: "center",
            padding: 12,
          }}
        >
          아직 히스토리가 없어요.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
          }}
        >
          {items.slice(0, 16).map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onSelect(it)}
              style={{
                all: "unset",
                cursor: "pointer",
                borderRadius: 6,
                overflow: "hidden",
              }}
              title={it.label}
            >
              <ImageTile seed={it.imageRef || it.id} aspect="1/1" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
