/**
 * StudioEmptyState — 결과 없음 상태 공통화 (audit R2-3).
 *
 * 기존: generate/edit/video/vision/compare 각 페이지가 개별 dashed 카드 사용.
 *   밀도(padding)·높이(minHeight)·radius 가 메뉴마다 달라 체감 불일치 있었음.
 *
 * Size:
 *   - normal: 기본 dashed 카드 (28px 20px padding · radius-card)
 *     → Generate/Edit/Video/Vision/Compare 의 우측 empty 용
 *   - compact: 얇은 한 줄 안내 (12px 16px padding · radius)
 *     → 좌측 작은 보조 영역 용
 *   - panel: normal 과 같은 문구 톤 + flex:1
 *     → Compare ViewerPanel 내부 empty 용
 *
 * props:
 *   - title: 메인 메시지 (panel 기준 큰 볼드)
 *   - description?: 보조 설명 (한 줄)
 *   - icon?: 상단 아이콘 (panel 변형에서 두드러짐)
 *   - children?: 커스텀 컨텐츠 (b 태그 등 인라인 강조 필요할 때)
 */

"use client";

import type { ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

type Size = "normal" | "compact" | "panel";

export default function StudioEmptyState({
  size = "normal",
  title,
  description,
  icon,
  children,
}: {
  size?: Size;
  title?: string;
  description?: string;
  icon?: IconName;
  children?: ReactNode;
}) {
  const body = children ?? (
    <>
      {title && <div className="ais-empty-state-title">{title}</div>}
      {description && (
        <div className="ais-empty-state-desc">{description}</div>
      )}
    </>
  );

  if (size === "panel") {
    return (
      <div
        className="ais-empty-state ais-empty-state-panel"
        style={{
          flex: 1,
        }}
      >
        {icon && <Icon name={icon} size={20} />}
        {body}
      </div>
    );
  }

  if (size === "compact") {
    return (
      <div
        style={{
          padding: "12px 16px",
          background: "var(--surface)",
          border: "1px dashed var(--line-2)",
          borderRadius: "var(--radius)",
          textAlign: "center",
          color: "var(--ink-4)",
          fontSize: 12,
          lineHeight: 1.55,
        }}
      >
        {children ?? (
          <>
            {title && <span style={{ fontWeight: 500 }}>{title}</span>}
            {description && <span>{description}</span>}
          </>
        )}
      </div>
    );
  }

  // normal
  return (
    <div className="ais-empty-state">
      {icon && <Icon name={icon} size={20} />}
      {body}
    </div>
  );
}
