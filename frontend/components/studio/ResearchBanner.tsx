/**
 * ResearchBanner — Generate 페이지의 Claude 프롬프트 조사 배너.
 * 2026-04-23 Opus F4: generate/page.tsx 에서 분리.
 * 2026-04-24: 결과를 토스트 대신 배너 내부 인라인으로 표시 (휘발성 제거).
 *
 * 구성:
 *   - 체크박스: 조사 기능 ON/OFF (실 생성 시 자동 조사 반영)
 *   - "힌트 미리 받기" 버튼: 생성 전에 Claude 힌트만 단독 조사
 *   - 결과 영역 (인라인): 로딩 spinner / 힌트 목록 / 에러 메시지
 */

"use client";

import { useState } from "react";
import Icon from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/primitives";

interface ResearchBannerProps {
  /** 체크박스 상태 */
  checked: boolean;
  /** 체크 변경 콜백 */
  onChange: (v: boolean) => void;
  /** "힌트 미리 받기" 클릭 — 단독 조사 실행 (결과는 배너가 직접 표시) */
  onPreview: () => void;

  /** 조사 진행 중 */
  loading?: boolean;
  /** 조사 결과 힌트 (null = 아직 실행 안 함, [] = 빈 결과, [...] = 힌트) */
  hints?: string[] | null;
  /** 실패 시 메시지 */
  error?: string | null;
}

export default function ResearchBanner({
  checked,
  onChange,
  onPreview,
  loading = false,
  hints = null,
  error = null,
}: ResearchBannerProps) {
  // "힌트 미리 받기" 버튼 hover — 배경색 변화로 버튼티 명확화
  const [hov, setHov] = useState(false);

  return (
    <div
      style={{
        padding: "14px 16px",
        background: "var(--amber-soft)",
        border: "1px solid rgba(250,173,20,.35)",
        borderRadius: "var(--radius)",
      }}
    >
      {/* 상단 — 체크박스 + 제목 + 배지 + 버튼 */}
      <label
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          cursor: "pointer",
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
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--amber-ink)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              letterSpacing: 0,
            }}
          >
            <Icon name="search" size={13} />
            Claude 프롬프트 조사
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault(); // label 의 체크박스 토글 기본 동작 차단
                e.stopPropagation();
                onPreview();
              }}
              onMouseEnter={() => setHov(true)}
              onMouseLeave={() => setHov(false)}
              disabled={loading}
              style={{
                marginLeft: "auto",
                all: "unset",
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: 10.5,
                fontWeight: 500,
                color: "var(--amber-ink)",
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid rgba(250,173,20,.35)",
                background: hov && !loading ? "rgba(250,173,20,.18)" : "#fff",
                transition: "background .12s",
                opacity: loading ? 0.6 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                flexShrink: 0,
              }}
              title="Claude 에게 힌트만 먼저 받아봐 (생성은 X)"
            >
              {loading ? <Spinner /> : <Icon name="search" size={11} />}
              {loading ? "조사 중…" : "힌트 미리 받기"}
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
            Claude 가 프롬프트를 분석해 개선 힌트를 반영합니다.
            <span style={{ color: "var(--ink-4)" }}> 약 +15s</span>
          </div>
        </div>
      </label>

      {/* 결과 영역 (인라인) — 로딩/힌트/에러 */}
      {(loading || hints !== null || error) && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px dashed rgba(250,173,20,.35)",
          }}
        >
          {loading && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--ink-3)",
              }}
            >
              <Spinner />
              <span>Claude 가 프롬프트를 분석 중…</span>
            </div>
          )}
          {!loading && error && (
            <div
              style={{
                fontSize: 12,
                color: "var(--amber-ink)",
                lineHeight: 1.5,
              }}
            >
              <b>조사 실패</b> · {error}
            </div>
          )}
          {!loading && !error && hints && hints.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-4)",
                lineHeight: 1.5,
              }}
            >
              Claude 가 특별히 추천할 힌트를 찾지 못했습니다. 현재 프롬프트로도 충분해 보여요.
            </div>
          )}
          {!loading && !error && hints && hints.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                  color: "var(--ink-3)",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon name="sparkle" size={11} />
                Claude 힌트 · {hints.length}건
              </div>
              <ul
                style={{
                  listStyle: "disc",
                  paddingLeft: 18,
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "var(--ink-2)",
                }}
              >
                {hints.map((h, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {h}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
