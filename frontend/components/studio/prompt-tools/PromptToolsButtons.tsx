/**
 * PromptToolsButtons - textarea 안 우측 도구 버튼 (번역 dropdown + 분리).
 *
 * Phase 5 후속 (2026-05-01) — `.ais-prompt-shell` 안 absolute 배치.
 * 히스토리 (top:10) 하단부터 세로 stack.
 *  · top:46 → 🌐 번역 dropdown (클릭 시 [한→영] [영→한] 메뉴 펼침)
 *  · top:78 → ▤ 분리 (즉시 실행)
 * 비우기 X (bottom:10) 와 충돌 X — 별도 위치.
 *
 * UX:
 *  - busy 시 해당 버튼 spinner only (폭 일정 — 26×26 박스 유지)
 *  - 휴리스틱 비활성: 번역 메뉴 항목 disabled + 사유 sub-text
 *  - 분리 비활성: phraseCount < 3 → tooltip 사유 노출
 *  - 외부 클릭 시 dropdown 닫힘 (ref 기반)
 */

"use client";

import { useEffect, useRef, useState } from "react";
import {
  countPhrases,
  hasEnglish,
  hasKorean,
} from "@/lib/prompt-language";
import type { UsePromptToolsReturn } from "@/hooks/usePromptTools";
import SplitIcon from "./SplitIcon";

interface Props {
  /** usePromptTools hook 반환 — state + 핸들러 */
  tools: UsePromptToolsReturn;
}

const SPLIT_PHRASE_THRESHOLD = 3;

export default function PromptToolsButtons({ tools }: Props) {
  const { busy, blocked, trimmedPrompt, runSplit, runTranslate } = tools;

  // 휴리스틱 — prompt 내용 기반 비활성 결정
  const koreanIn = hasKorean(trimmedPrompt);
  const englishIn = hasEnglish(trimmedPrompt);
  const phraseCount = countPhrases(trimmedPrompt);

  const splitDisabled = blocked || phraseCount < SPLIT_PHRASE_THRESHOLD;
  const splitTitle = blocked
    ? "잠시 대기 중"
    : phraseCount < SPLIT_PHRASE_THRESHOLD
    ? `phrase ${phraseCount}개 · 분리는 ${SPLIT_PHRASE_THRESHOLD}개 이상 권장`
    : "카테고리 카드로 분리";

  // 번역 dropdown 상태
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const translateBusy =
    busy === "translate-en" || busy === "translate-ko";
  const translateDisabled = blocked && !translateBusy;
  const translateBtnTitle = blocked
    ? "잠시 대기 중"
    : !koreanIn && !englishIn
    ? "한글/영문 없음"
    : "번역 도구";

  // 메뉴 항목 비활성 사유
  const koItemDisabled = blocked || !englishIn; // 영→한: 영문 없으면 disabled
  const enItemDisabled = blocked || !koreanIn; // 한→영: 한글 없으면 disabled

  return (
    <div
      className="ais-prompt-tools-stack"
      // 안전망 — globals.css 의 .ais-prompt-tools-stack 가 hot-reload 안 잡힌 dev 환경 대비.
      // CSS 가 정상 로드되면 inline 과 동일값이라 영향 X. 미로드 시 inline 이 fallback.
      style={{
        position: "absolute",
        top: 46,
        right: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        zIndex: 5,
      }}
    >
      {/* 번역 — dropdown */}
      <div ref={menuRef} style={{ position: "relative" }}>
        <button
          type="button"
          className="ais-prompt-tool-btn"
          disabled={translateDisabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={translateBtnTitle}
          onClick={() => {
            if (translateDisabled) return;
            setMenuOpen((v) => !v);
          }}
        >
          {translateBusy ? (
            <Spinner />
          ) : (
            // 둥근 지구 SVG — 번역의 추상 의미
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              style={{ opacity: 0.85 }}
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18" />
              <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </svg>
          )}
        </button>

        {menuOpen && !translateBusy && (
          <div className="ais-prompt-tool-menu" role="menu">
            <MenuItem
              label="한 → 영"
              hint={
                koreanIn
                  ? "한국어를 영문으로 (모델 호환)"
                  : "한글 없음 · 비활성"
              }
              disabled={enItemDisabled}
              onClick={() => {
                setMenuOpen(false);
                void runTranslate("en");
              }}
            />
            <MenuItem
              label="영 → 한"
              hint={
                englishIn ? "영문을 한국어로 (확인용)" : "영문 없음 · 비활성"
              }
              disabled={koItemDisabled}
              onClick={() => {
                setMenuOpen(false);
                void runTranslate("ko");
              }}
            />
          </div>
        )}
      </div>

      {/* 분리 — 즉시 실행 */}
      <button
        type="button"
        className="ais-prompt-tool-btn"
        disabled={splitDisabled}
        title={splitTitle}
        aria-label="카테고리 카드로 분리"
        onClick={() => {
          if (splitDisabled) return;
          void runSplit();
        }}
      >
        {busy === "split" ? <Spinner /> : <SplitIcon />}
      </button>
    </div>
  );
}

/* ─────────────────────────────────
   sub — 메뉴 항목
   ───────────────────────────────── */

function MenuItem({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="ais-prompt-tool-menuitem"
      title={disabled ? hint : undefined}
    >
      <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
      <span
        style={{
          fontSize: 10.5,
          color: "var(--ink-4)",
          marginTop: 1,
          fontWeight: 400,
        }}
      >
        {hint}
      </span>
    </button>
  );
}

/* ─────────────────────────────────
   sub — 26×26 박스 안 작은 spinner
   ───────────────────────────────── */

function Spinner() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
      style={{
        animation: "ais-spin 0.9s linear infinite",
      }}
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.55" />
    </svg>
  );
}
