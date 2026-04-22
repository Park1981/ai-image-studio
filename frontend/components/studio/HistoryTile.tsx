/**
 * HistoryTile - 히스토리 그리드에서 사용하는 이미지 타일.
 * ImageTile + hover 시 상단 우측에 삭제 버튼.
 *
 * 삭제: 서버에도 전파 (useHistoryStore.remove + api-client.deleteHistoryItem).
 */

"use client";

import { useState, type CSSProperties } from "react";
import ImageTile from "@/components/ui/ImageTile";
import Icon from "@/components/ui/Icon";
import { deleteHistoryItem, type HistoryItem } from "@/lib/api-client";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";

interface Props {
  item: HistoryItem;
  selected: boolean;
  onClick: () => void;
  /** 삭제 후 부모에서 처리할 추가 로직 (예: selected=null) */
  onAfterDelete?: () => void;
  aspect?: string;
  style?: CSSProperties;
}

export default function HistoryTile({
  item,
  selected,
  onClick,
  onAfterDelete,
  aspect = "1/1",
  style,
}: Props) {
  const [hover, setHover] = useState(false);
  const remove = useHistoryStore((s) => s.remove);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // confirm 은 생략 — 실수 방지 필요하면 추후 추가. 현재는 store 에 남아있으니 복구는 새로고침 전에는 불가.
    remove(item.id);
    try {
      await deleteHistoryItem(item.id);
    } catch (err) {
      toast.warn(
        "서버 삭제 실패",
        err instanceof Error ? err.message : "로컬만 제거됨",
      );
    }
    toast.info("삭제됨", item.label);
    onAfterDelete?.();
  };

  return (
    <div
      style={{ position: "relative", ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <ImageTile
        seed={item.imageRef || item.id}
        label={item.label}
        onClick={onClick}
        aspect={aspect}
        style={{
          border: selected
            ? "2px solid var(--accent)"
            : "2px solid transparent",
          transition: "transform .15s",
          boxShadow: selected ? "0 0 0 4px rgba(74,158,255,.15)" : "none",
        }}
      />
      {hover && (
        <button
          type="button"
          onClick={handleDelete}
          title="삭제"
          style={{
            all: "unset",
            cursor: "pointer",
            position: "absolute",
            top: 6,
            right: 6,
            width: 26,
            height: 26,
            borderRadius: 999,
            background: "rgba(0,0,0,.55)",
            backdropFilter: "blur(4px)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            border: "1px solid rgba(255,255,255,.15)",
            transition: "background .15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(192,57,43,.92)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(0,0,0,.55)";
          }}
        >
          <Icon name="x" size={13} stroke={2.4} />
        </button>
      )}
    </div>
  );
}
