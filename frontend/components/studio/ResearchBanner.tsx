/**
 * ResearchBanner — Generate 페이지의 "조사 필요" 체크박스 배너.
 * 2026-04-23 Opus F4: generate/page.tsx 에서 분리 (~85줄 → 별도 컴포넌트).
 *
 * 체크박스 토글 + "미리보기" 버튼 (지금 바로 Claude CLI 조사만 실행).
 * 활성화 시 ~+15s 추가 소요 안내.
 */

"use client";

import Icon from "@/components/ui/Icon";

interface ResearchBannerProps {
  /** 현재 체크 상태 */
  checked: boolean;
  /** 체크 변경 시 */
  onChange: (v: boolean) => void;
  /** "미리보기" — 조사만 단독 실행 (모달 대신 토스트 힌트) */
  onPreview: () => void;
}

export default function ResearchBanner({
  checked,
  onChange,
  onPreview,
}: ResearchBannerProps) {
  return (
    <label
      style={{
        display: "flex",
        gap: 12,
        padding: "14px 16px",
        background: "var(--amber-soft)",
        border: "1px solid rgba(250,173,20,.35)",
        borderRadius: 10,
        cursor: "pointer",
        alignItems: "flex-start",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          marginTop: 3,
          accentColor: "var(--amber-ink)",
          width: 15,
          height: 15,
        }}
      />
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--amber-ink)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            letterSpacing: "-0.005em",
          }}
        >
          <Icon name="search" size={13} />
          조사 필요{" "}
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              background: "#FFF",
              border: "1px solid rgba(250,173,20,.35)",
              borderRadius: 4,
              padding: "1px 6px",
              color: "var(--amber-ink)",
            }}
          >
            퀄리티 업
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onPreview();
            }}
            style={{
              marginLeft: "auto",
              all: "unset",
              cursor: "pointer",
              fontSize: 10.5,
              color: "var(--amber-ink)",
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid rgba(250,173,20,.35)",
              background: "#fff",
            }}
            title="지금 바로 조사만 실행"
          >
            미리보기
          </button>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-2)",
            marginTop: 4,
            lineHeight: 1.55,
          }}
        >
          Claude CLI로 최신 모델 정보·프롬프트 스타일을 조사한 뒤 반영합니다.
          <span style={{ color: "var(--ink-4)" }}> 약 +15s</span>
        </div>
      </div>
    </label>
  );
}
