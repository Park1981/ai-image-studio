/**
 * AiEnhanceCard - HistoryItem 의 AI 보강 결과를 시각화.
 *
 * 표시 항목:
 * - 원본 프롬프트 (접힐 수 있는 레이블만 먼저)
 * - gemma4 업그레이드 결과 + provider 뱃지 (ollama/fallback)
 * - Claude 조사 힌트 리스트 (있을 때만)
 * - 수정 모드 비전 설명 (있을 때만)
 * - ComfyUI 에러 (있을 때)
 *
 * Generate 페이지 selected preview 아래, Edit 페이지 Before/After 아래에 배치.
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { toast } from "@/stores/useToastStore";
import type { HistoryItem } from "@/lib/api-client";

export default function AiEnhanceCard({ item }: { item: HistoryItem }) {
  const [openOriginal, setOpenOriginal] = useState(false);
  const [openUpgraded, setOpenUpgraded] = useState(true);

  const hasUpgrade =
    item.upgradedPrompt && item.upgradedPrompt !== item.prompt;
  const hasHints = (item.researchHints?.length ?? 0) > 0;
  const hasVision = !!item.visionDescription;
  const hasError = !!item.comfyError;
  const isFallback = item.promptProvider === "fallback";

  // 표시할 게 아무것도 없으면 카드 자체를 숨김
  if (!hasUpgrade && !hasHints && !hasVision && !hasError && !isFallback) {
    return null;
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} 복사됨`);
    } catch {
      toast.error("복사 실패", "클립보드 권한을 확인해 주세요.");
    }
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: ".08em",
            color: "var(--ink-3)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="sparkle" size={12} />
          AI 보강 결과
        </div>
        <ProviderBadge provider={item.promptProvider} />
      </div>

      {/* 원본 (기본 접힘) */}
      <Row
        label="원본 입력"
        open={openOriginal}
        onToggle={() => setOpenOriginal((v) => !v)}
      >
        <p style={textStyle}>{item.prompt}</p>
      </Row>

      {/* 업그레이드 (기본 펼침) */}
      {hasUpgrade && (
        <Row
          label={
            isFallback ? "업그레이드 (폴백)" : "gemma4 업그레이드"
          }
          open={openUpgraded}
          onToggle={() => setOpenUpgraded((v) => !v)}
          action={
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copy(item.upgradedPrompt!, "업그레이드 프롬프트");
              }}
              style={iconBtn}
              title="복사"
            >
              <Icon name="copy" size={11} />
            </button>
          }
        >
          <p
            style={{
              ...textStyle,
              background: isFallback ? "var(--amber-soft)" : "var(--bg-2)",
              border: `1px solid ${isFallback ? "rgba(250,173,20,.35)" : "var(--line)"}`,
            }}
          >
            {item.upgradedPrompt}
          </p>
        </Row>
      )}

      {/* Claude 조사 힌트 */}
      {hasHints && (
        <div>
          <div style={labelStyle}>
            <Icon name="search" size={11} />
            Claude 조사 · {item.researchHints!.length} hints
          </div>
          <ul
            style={{
              margin: 0,
              padding: "6px 0 0 18px",
              fontSize: 12,
              color: "var(--ink-2)",
              lineHeight: 1.55,
              listStyle: "disc",
            }}
          >
            {item.researchHints!.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 비전 설명 (수정 모드) */}
      {hasVision && (
        <div>
          <div style={labelStyle}>
            <Icon name="image" size={11} />
            비전 모델 설명
          </div>
          <p style={{ ...textStyle, marginTop: 6 }}>{item.visionDescription}</p>
        </div>
      )}

      {/* ComfyUI 에러 */}
      {hasError && (
        <div
          style={{
            padding: "8px 10px",
            background: "#FCEDEC",
            border: "1px solid rgba(192,57,43,.32)",
            borderRadius: 8,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Icon name="x" size={12} style={{ color: "#C0392B", marginTop: 2 }} />
          <div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "#C0392B",
                marginBottom: 2,
              }}
            >
              ComfyUI 에러 · Mock 폴백 적용됨
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--ink-2)",
                lineHeight: 1.55,
                wordBreak: "break-all",
              }}
            >
              {item.comfyError}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderBadge({ provider }: { provider?: string }) {
  if (!provider) return null;
  const isFallback = provider === "fallback";
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: 4,
        border: `1px solid ${isFallback ? "rgba(250,173,20,.35)" : "var(--line)"}`,
        background: isFallback ? "var(--amber-soft)" : "var(--bg-2)",
        color: isFallback ? "var(--amber-ink)" : "var(--ink-3)",
        letterSpacing: ".04em",
        textTransform: "uppercase",
      }}
    >
      {provider}
    </span>
  );
}

function Row({
  label,
  open,
  onToggle,
  action,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          cursor: "pointer",
        }}
        onClick={onToggle}
      >
        <div
          style={{
            ...labelStyle,
            color: "var(--ink-3)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon
            name="chevron-down"
            size={10}
            style={{
              transform: open ? "rotate(0)" : "rotate(-90deg)",
              transition: "transform .15s",
            }}
          />
          {label}
        </div>
        {action}
      </div>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "var(--ink-3)",
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const textStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  lineHeight: 1.6,
  color: "var(--ink-2)",
  padding: "8px 10px",
  background: "var(--bg-2)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const iconBtn: React.CSSProperties = {
  all: "unset",
  cursor: "pointer",
  padding: "2px 6px",
  borderRadius: 4,
  color: "var(--ink-3)",
  border: "1px solid var(--line)",
  background: "var(--bg)",
  fontSize: 10,
  display: "inline-flex",
  alignItems: "center",
};
