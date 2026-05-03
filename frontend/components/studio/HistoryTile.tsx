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
 *
 * 2026-05-02 디자인 V5 Phase 4 격상 (결정 R):
 *  - inline border/box-shadow 제거 → wrapper className `.ais-history-tile` + data-selected (V5 violet ring 자동)
 *  - selected 시 흰 ring 2 + violet ring 4 + `● 선택` 칩 (CSS pseudo-element 가 자동 처리)
 *  - hover 액션바 4 버튼 (자세히 / 복사 / 수정 / 삭제) — 옛 3 버튼에 **복사** 추가
 *  - onCopy 미지정 시 default = item.prompt 복사 (clipboard + toast)
 *  - ResultHoverActionBar variant="tile" 명시 (V5 .ais-tile-action-bar 위치 톤)
 *
 * 삭제는 서버에도 전파 (useHistoryStore.remove + api-client.deleteHistoryItem).
 */

"use client";

import { useState, type CSSProperties } from "react";
import ImageTile from "@/components/ui/ImageTile";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";
import Badge from "@/components/ui/Badge";
import { deleteHistoryItem } from "@/lib/api/history";
import { copyText } from "@/lib/image-actions";
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
  /**
   * "복사" 콜백 (옵셔널 · V5 Phase 4 신규).
   * 미지정 시 default = item.prompt 클립보드 복사 (toast 포함).
   */
  onCopy?: () => void;
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
  onCopy,
  aspect = "1/1",
  style,
}: Props) {
  const [hover, setHover] = useState(false);
  const remove = useHistoryStore((s) => s.remove);
  const restore = useHistoryStore((s) => s.add);

  // onExpand/onDoubleClick 중 정의된 쪽 사용 (하위호환)
  const triggerExpand = onExpand ?? onDoubleClick;

  /** default 복사 — onCopy 미지정 시 prompt 복사. prompt 비어있으면 안내 toast. */
  const handleCopy =
    onCopy ??
    (() => {
      if (item.prompt) {
        void copyText(item.prompt, "프롬프트");
      } else {
        toast.info("복사할 프롬프트 없음");
      }
    });

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
      className="ais-history-tile"
      data-selected={selected ? "true" : "false"}
      style={{ aspectRatio: aspect, ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={triggerExpand}
    >
      {/* ImageTile inline border 제거 — V5 wrapper 의 violet ring 이 selected 시각 담당.
          ImageTile 자체의 radius/overflow 는 그대로 두고 V5 wrapper 가 더 큰 radius cascade. */}
      <ImageTile
        seed={item.imageRef || item.id}
        onClick={onClick}
        aspect={aspect}
        style={{
          width: "100%",
          height: "100%",
          // wrapper 가 radius 처리 — inner ImageTile 은 시각 충돌 회피용 transparent border
          border: "none",
          boxShadow: "none",
        }}
      />

      {/* Phase 5 (2026-05-03 · spec §5.7) — Video mode 시 모델 배지.
       *  - 위치: top-RIGHT (옛 left 는 "● 선택" 칩과 충돌 — top:9, left:9 z-index:4)
       *  - tone 결정: modelId 우선 → 누락 시 model 문자열 fallback (Wan 포함 → violet)
       *    Phase 5 follow-up 3 (2026-05-03 fix): 옛 row (서버 재로드 후 modelId 없음) 도
       *    시각 일관 위해 display_name 기반 추론. */}
      {item.mode === "video" && item.model && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <Badge
            tone={
              item.modelId === "wan22" ||
              (item.modelId == null && /wan/i.test(item.model))
                ? "violet"
                : "cyan"
            }
            title={`영상 모델: ${item.model}`}
          >
            {item.model}
          </Badge>
        </div>
      )}

      {/* 결과 뷰어와 동일한 글래스 pill — 호버 시 통통 등장 (V5 tile variant) */}
      <div onClick={(e) => e.stopPropagation()}>
        <ResultHoverActionBar hovered={hover} variant="tile">
          {triggerExpand && (
            <ActionBarButton
              icon="zoom-in"
              title="라이트박스에서 크게 보기"
              size="tile"
              onClick={() => {
                // 라이트박스 메타 패널이 "현재 선택된 아이템" 기준이므로
                // 이 타일을 먼저 선택 → 그 뒤 확장. 아니면 이전 선택의 메타가 보임.
                onClick();
                triggerExpand();
              }}
            />
          )}
          {/* V5 신규 — 복사 버튼 (4 버튼 시그니처) */}
          <ActionBarButton
            icon="copy"
            title="프롬프트 복사"
            size="tile"
            onClick={handleCopy}
          />
          {onUseAsSource && (
            <ActionBarButton
              icon="edit"
              title="이 이미지를 수정 원본으로"
              size="tile"
              onClick={onUseAsSource}
            />
          )}
          {onSendToEdit && (
            <ActionBarButton
              icon="edit"
              title="수정으로 이동"
              size="tile"
              onClick={onSendToEdit}
            />
          )}
          <ActionBarButton
            icon="x"
            title="삭제"
            variant="danger"
            size="tile"
            onClick={handleDelete}
          />
        </ResultHoverActionBar>
      </div>
    </div>
  );
}
