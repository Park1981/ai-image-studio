/**
 * SelectedItemPreview — Generate 페이지의 선택 아이템 미리보기 카드.
 * 2026-04-23 Opus F4: generate/page.tsx 에서 분리 (~150줄 → 별도 컴포넌트).
 *
 * 좌 썸네일 + 우 메타/버튼(저장/복사/수정으로/재생성).
 */

"use client";

import type { HistoryItem } from "@/lib/api-client";
import ImageTile from "@/components/ui/ImageTile";
import { Meta, SmallBtn } from "@/components/ui/primitives";
import { GENERATE_MODEL, activeLoras, countExtraLoras } from "@/lib/model-presets";

interface Props {
  item: HistoryItem;
  /** 저장(다운로드) */
  onDownload: () => void;
  /** 클립보드 복사 */
  onCopy: () => void;
  /** Edit 페이지로 "수정으로" 이동 */
  onSendToEdit: () => void;
  /** 폼에 같은 설정 로드 */
  onReuse: () => void;
}

export default function SelectedItemPreview({
  item,
  onDownload,
  onCopy,
  onSendToEdit,
  onReuse,
}: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) 220px",
        gap: 16,
        padding: 16,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <ImageTile seed={item.imageRef || item.id} aspect="1/1" />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          minWidth: 0,
        }}
      >
        <div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: ".08em",
            }}
          >
            #{item.id.slice(-6).toUpperCase()}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              marginTop: 4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.label}
          </div>
        </div>
        <Meta k="모델" v={item.model} />
        <Meta k="사이즈" v={`${item.width}×${item.height}`} />
        <Meta
          k="스텝/CFG"
          v={`${item.steps} · ${item.cfg}${item.lightning ? " ⚡" : ""}`}
        />
        <Meta k="Seed" v={<span className="mono">{item.seed}</span>} />
        <Meta
          k="LoRA"
          v={`${activeLoras(GENERATE_MODEL, item.lightning).length} 적용 (+${countExtraLoras(GENERATE_MODEL)})`}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            marginTop: "auto",
          }}
        >
          <SmallBtn icon="download" onClick={onDownload}>
            저장
          </SmallBtn>
          <SmallBtn icon="copy" onClick={onCopy}>
            복사
          </SmallBtn>
          <SmallBtn icon="edit" onClick={onSendToEdit}>
            수정으로
          </SmallBtn>
          <SmallBtn icon="sparkle" onClick={onReuse}>
            재생성
          </SmallBtn>
        </div>
      </div>
    </div>
  );
}

