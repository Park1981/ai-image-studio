/**
 * GenerateResultViewer — Generate 페이지 결과 이미지 뷰어 + 호버 액션바.
 *
 * 2026-04-26 (task #5): generate/page.tsx 에서 별도 파일로 분리.
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
  onCopy: () => void;
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
  onCopy,
  onSendToEdit,
  onReuse,
}: Props) {
  // 원본 비율 — width/height 없으면 1/1 폴백
  const aspectRatio =
    item.width > 0 && item.height > 0
      ? `${item.width} / ${item.height}`
      : "1 / 1";

  // 액션바 좌측 요약 — 프롬프트 한 줄 + 사이즈
  const summary = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontSize: 12,
        }}
        title={item.prompt}
      >
        {item.prompt}
      </span>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "rgba(255,255,255,.72)",
          letterSpacing: ".04em",
          flexShrink: 0,
        }}
      >
        {item.width}×{item.height}
      </span>
    </div>
  );

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
        cursor: "zoom-in",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onExpand();
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

      {/* 하단 호버 액션바 */}
      <div onClick={(e) => e.stopPropagation()}>
        <ResultHoverActionBar hovered={hovered} summary={summary}>
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
            title="클립보드 복사"
            onClick={onCopy}
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
