/**
 * HistoryTile - 히스토리 그리드 이미지 타일.
 * 2026-04-24 UI 개편:
 *  - ImageTile label 제거 — 프롬프트 한 줄이 이미지 위에 겹쳐 보이던 현상 해소
 *  - hover 시 하단 액션 바에 [자세히 · 원본으로? · 삭제] 일렬 노출
 *  - double-click 도 계속 "자세히" 로 동작 (편의 유지)
 *
 * 2026-04-27 액션바 풀 통일:
 *  - 자체 BarButton 제거 → ResultHoverActionBar + ActionBarButton 사용
 *  - 결과 뷰어와 동일한 글래스 pill + spring 통통 인터랙션
 *  - 호버 시 마운트가 아닌 항상 마운트 + hovered prop 토글 → spring 애니메이션 살림
 *
 * 삭제는 서버에도 전파 (useHistoryStore.remove + api-client.deleteHistoryItem).
 */

"use client";

import { useState, type CSSProperties } from "react";
import ImageTile from "@/components/ui/ImageTile";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";
import { deleteHistoryItem } from "@/lib/api/history";
import type { HistoryItem } from "@/lib/api/types";
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
  /**
   * "수정으로 이동" 콜백 — 있을 때만 hover 바 가운데 버튼 노출.
   * 주로 generate 히스토리에서 결과 이미지를 /edit 의 원본으로 보내는 용도.
   */
  onSendToEdit?: () => void;
  aspect?: string;
  style?: CSSProperties;
}

export default function HistoryTile({
  item,
  selected,
  onClick,
  onAfterDelete,
  onExpand,
  onDoubleClick,
  onUseAsSource,
  onSendToEdit,
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

      {/* 결과 뷰어와 동일한 글래스 pill — 호버 시 통통 등장 */}
      <div onClick={(e) => e.stopPropagation()}>
        <ResultHoverActionBar hovered={hover}>
          {triggerExpand && (
            <ActionBarButton
              icon="zoom-in"
              title="라이트박스에서 크게 보기"
              onClick={() => {
                // 라이트박스 메타 패널이 "현재 선택된 아이템" 기준이므로
                // 이 타일을 먼저 선택 → 그 뒤 확장. 아니면 이전 선택의 메타가 보임.
                onClick();
                triggerExpand();
              }}
            />
          )}
          {onUseAsSource && (
            <ActionBarButton
              icon="edit"
              title="이 이미지를 수정 원본으로"
              onClick={onUseAsSource}
            />
          )}
          {onSendToEdit && (
            <ActionBarButton
              icon="edit"
              title="수정으로 이동"
              onClick={onSendToEdit}
            />
          )}
          <ActionBarButton
            icon="x"
            title="삭제"
            variant="danger"
            onClick={handleDelete}
          />
        </ResultHoverActionBar>
      </div>
    </div>
  );
}
