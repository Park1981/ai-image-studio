/**
 * GenerateResultViewer — Generate 페이지 결과 이미지 뷰어 + 호버 액션바.
 *
 * 2026-04-26 (task #5): generate/page.tsx 에서 별도 파일로 분리.
 * 2026-04-27 (UX 폴리시):
 *  - summary 제거 (프롬프트 요약 안 보임 — 버튼 그룹만 통통 튀듯 등장)
 *  - 복사 버튼 → 프롬프트 복사 (이미지 복사 → 텍스트 클립보드)
 */

"use client";

import type { HistoryItem } from "@/lib/api/types";
import ResultHoverActionBar, {
  ActionBarButton,
} from "@/components/studio/ResultHoverActionBar";

interface Props {
  item: HistoryItem;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onExpand: () => void;
  onDownload: () => void;
  /** 프롬프트 텍스트 클립보드 복사 (2026-04-27 변경 — 옛 이미지 복사 X) */
  onCopyPrompt: () => void;
  onSendToEdit: () => void;
  onReuse: () => void;
}

export default function GenerateResultViewer({
  item,
  hovered,
  onEnter,
  onLeave,
  onExpand,
  onDownload,
  onCopyPrompt,
  onSendToEdit,
  onReuse,
}: Props) {
  // 원본 비율 — width/height 없으면 1/1 폴백
  const aspectRatio =
    item.width > 0 && item.height > 0
      ? `${item.width} / ${item.height}`
      : "1 / 1";

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "relative",
        width: "100%",
        // 결과 뷰어: 원본 비율 유지 + 최대 높이 65vh 제한. contain 으로 레터박스.
        aspectRatio,
        maxHeight: "65vh",
        background: "var(--bg-2)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
        // 2026-04-27: 이미지 클릭 자세히 보기 제거 — 액션바 zoom-in 버튼이 동일 역할.
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.imageRef}
        alt={item.label}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
          // @ts-expect-error — 비표준 Webkit
          WebkitUserDrag: "none",
          userSelect: "none",
        }}
      />

      {/* 하단 호버 액션바 — summary 없음 (버튼만) */}
      <div onClick={(e) => e.stopPropagation()}>
        <ResultHoverActionBar hovered={hovered}>
          <ActionBarButton
            icon="zoom-in"
            title="크게 보기"
            onClick={onExpand}
          />
          <ActionBarButton
            icon="download"
            title="저장"
            onClick={onDownload}
          />
          <ActionBarButton
            icon="copy"
            title="프롬프트 복사"
            onClick={onCopyPrompt}
          />
          <ActionBarButton
            icon="edit"
            title="수정으로"
            onClick={onSendToEdit}
          />
          <ActionBarButton
            icon="refresh"
            title="재생성 (파라미터 복원)"
            onClick={onReuse}
          />
        </ResultHoverActionBar>
      </div>
    </div>
  );
}
