/**
 * HistoryTile - 히스토리 그리드 이미지 타일.
 * 2026-04-24 UI 개편:
 *  - ImageTile label 제거 — 프롬프트 한 줄이 이미지 위에 겹쳐 보이던 현상 해소
 *  - hover 시 하단 액션 바에 [자세히 · 원본으로? · 삭제] 일렬 노출
 *  - double-click 도 계속 "자세히" 로 동작 (편의 유지)
 *
 * 삭제는 서버에도 전파 (useHistoryStore.remove + api-client.deleteHistoryItem).
 */

"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import ImageTile from "@/components/ui/ImageTile";
import Icon, { type IconName } from "@/components/ui/Icon";
import { deleteHistoryItem, type HistoryItem } from "@/lib/api-client";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { toast } from "@/stores/useToastStore";

interface Props {
  item: HistoryItem;
  selected: boolean;
  onClick: () => void;
  /** 삭제 후 부모에서 처리할 추가 로직 (예: selected=null) */
  onAfterDelete?: () => void;
  /**
   * "자세히" 액션 — 라이트박스 열기 등.
   * hover 바의 첫 버튼 + tile 전체 double-click 둘 다 이 콜백 호출.
   */
  onExpand?: () => void;
  /** @deprecated onExpand 사용. 하위호환 유지 — 기존 호출처 변경 전까지 alias. */
  onDoubleClick?: () => void;
  /**
   * "원본으로" 콜백 — 있을 때만 hover 바 가운데 버튼 노출.
   * 수정 모드 히스토리에서 연속 수정 플로우용.
   */
  onUseAsSource?: () => void;
  aspect?: string;
  style?: CSSProperties;
}

/** hover 바 공통 버튼 — 아이콘 + 라벨. */
function BarButton({
  icon,
  label,
  title,
  onClick,
  variant = "neutral",
}: {
  icon: IconName;
  label: ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: "neutral" | "primary" | "danger";
}) {
  const [hov, setHov] = useState(false);
  const palette = {
    neutral: {
      bg: "rgba(0,0,0,.55)",
      bgHov: "rgba(0,0,0,.75)",
    },
    primary: {
      bg: "rgba(74,158,255,.88)",
      bgHov: "rgba(74,158,255,1)",
    },
    danger: {
      bg: "rgba(0,0,0,.55)",
      bgHov: "rgba(192,57,43,.92)",
    },
  }[variant];
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: ".02em",
        color: "#fff",
        background: hov ? palette.bgHov : palette.bg,
        backdropFilter: "blur(4px)",
        border: "1px solid rgba(255,255,255,.18)",
        transition: "background .15s, transform .15s",
        transform: hov ? "scale(1.03)" : "scale(1)",
      }}
    >
      <Icon name={icon} size={11} stroke={2.2} />
      {label}
    </button>
  );
}

export default function HistoryTile({
  item,
  selected,
  onClick,
  onAfterDelete,
  onExpand,
  onDoubleClick,
  onUseAsSource,
  aspect = "1/1",
  style,
}: Props) {
  const [hover, setHover] = useState(false);
  const remove = useHistoryStore((s) => s.remove);
  const restore = useHistoryStore((s) => s.add);

  // onExpand/onDoubleClick 중 정의된 쪽 사용 (하위호환)
  const triggerExpand = onExpand ?? onDoubleClick;

  /**
   * 옵티미스틱 삭제 — 즉시 UI 에서 제거하고 서버 호출.
   * 서버 실패 시 store.add 로 원본 복원 + 사용자 안내 (데이터 손실 방지).
   */
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    remove(item.id);
    try {
      await deleteHistoryItem(item.id);
      toast.info("삭제됨", item.label);
      onAfterDelete?.();
    } catch (err) {
      // 서버 실패 → 로컬 복원
      restore(item);
      toast.error(
        "삭제 실패 · 복원됨",
        err instanceof Error ? err.message : "서버 응답 없음",
      );
    }
  };

  return (
    <div
      style={{ position: "relative", ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={triggerExpand}
    >
      <ImageTile
        seed={item.imageRef || item.id}
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

      {/* hover 액션 바 — 하단에 그라디언트 + 버튼 일렬 */}
      {hover && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "22px 8px 8px",
            background:
              "linear-gradient(to top, rgba(0,0,0,.55) 0%, transparent 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            pointerEvents: "none", // 버튼만 클릭, 그라디언트는 통과
          }}
        >
          <div
            style={{
              display: "inline-flex",
              gap: 6,
              pointerEvents: "auto",
            }}
          >
            {triggerExpand && (
              <BarButton
                icon="zoom-in"
                label="자세히"
                title="라이트박스에서 크게 보기"
                onClick={(e) => {
                  e.stopPropagation();
                  // 라이트박스 메타 패널이 "현재 선택된 아이템" 기준이므로
                  // 이 타일을 먼저 선택 → 그 뒤 확장. 아니면 이전 선택의 메타가 보임.
                  onClick();
                  triggerExpand();
                }}
              />
            )}
            {onUseAsSource && (
              <BarButton
                icon="edit"
                label="원본으로"
                title="이 이미지를 수정 원본으로"
                variant="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onUseAsSource();
                }}
              />
            )}
          </div>
          <div style={{ pointerEvents: "auto" }}>
            <BarButton
              icon="x"
              label=""
              title="삭제"
              variant="danger"
              onClick={handleDelete}
            />
          </div>
        </div>
      )}
    </div>
  );
}
