/**
 * ReferenceRoleSelect — Multi-reference Edit 모드의 참조 역할 선택.
 *
 * preset 5개 (얼굴 / 의상 / 스타일 / 배경 / 직접) chip 형식.
 * "직접" 선택 시 자유 텍스트 입력 박스 노출.
 *
 * 2026-04-27 (Edit Multi-Reference Phase 2).
 */

"use client";

import type { ReferenceRoleId } from "@/stores/useEditStore";

interface RolePreset {
  id: ReferenceRoleId;
  emoji: string;
  label: string;
  desc: string;
}

const ROLE_PRESETS: RolePreset[] = [
  { id: "face",       emoji: "👤", label: "얼굴",   desc: "얼굴 정체성 유지" },
  { id: "outfit",     emoji: "👗", label: "의상",   desc: "옷/액세서리만 차용" },
  { id: "style",      emoji: "🎨", label: "스타일", desc: "색감/조명/톤" },
  { id: "background", emoji: "🏞️", label: "배경",   desc: "환경/배경" },
  { id: "custom",     emoji: "✏️", label: "직접",   desc: "자유 텍스트 입력" },
];

interface Props {
  selected: ReferenceRoleId;
  onSelect: (id: ReferenceRoleId) => void;
  customText: string;
  onCustomTextChange: (text: string) => void;
}

export default function ReferenceRoleSelect({
  selected,
  onSelect,
  customText,
  onCustomTextChange,
}: Props) {
  // 현재 선택된 preset의 설명 텍스트
  const activeDesc =
    ROLE_PRESETS.find((p) => p.id === selected)?.desc ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 섹션 레이블 */}
      <div
        style={{
          fontSize: 11.5,
          color: "var(--ink-3)",
          fontWeight: 500,
        }}
      >
        참조 역할
      </div>

      {/* 역할 chip 목록 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {ROLE_PRESETS.map((p) => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              title={p.desc}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "5px 10px",
                fontSize: 11.5,
                fontWeight: 600,
                borderRadius: "var(--radius-full)",
                border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                background: active ? "var(--accent-soft)" : "var(--bg)",
                color: active ? "var(--accent-ink)" : "var(--ink-2)",
                transition: "all .15s",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span aria-hidden>{p.emoji}</span>
              {p.label}
            </button>
          );
        })}
      </div>

      {/* "직접" 선택 시 자유 텍스트 입력 / 그 외 설명 텍스트 */}
      {selected === "custom" ? (
        <input
          type="text"
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          placeholder="예: 헤어스타일 참조 / 손 포즈 참조 / 배경 분위기"
          style={{
            all: "unset",
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            fontSize: 12,
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
        />
      ) : (
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            paddingLeft: 2,
          }}
        >
          {activeDesc}
        </div>
      )}
    </div>
  );
}
