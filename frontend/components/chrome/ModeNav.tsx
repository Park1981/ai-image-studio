/**
 * ModeNav — AppHeader 중앙 6 chip 세그먼티드 네비게이션 (V5 · Phase 2 · 결정 M).
 *
 * 시안 (`docs/design-test/pair-generate.html` v7) 1:1 포팅:
 *   - 6 chip: Home / Generate / Edit / Video / Analyze / Compare
 *   - Fraunces italic 13px (좌측 mode-header 와 페어 — editorial 톤 통일)
 *   - 활성: 흰 surface + 그림자 / 비활성: ghost (subtle bg container)
 *   - 호버: spring 통통 `cubic-bezier(0.34, 1.56, 0.64, 1)` overshoot
 *
 * 활성 chip 판정 우선순위 (`/vision/compare` exact priority — Codex 1차 🔴 보강):
 *   1. `pathname === "/vision/compare"` → Compare chip
 *   2. `pathname === "/vision"` → Analyze chip
 *   3. `pathname.startsWith("/vision/")` 의 다른 sub-path → Analyze chip 폴백
 *   4. `pathname === "/"` → Home chip
 *   5. `pathname === "/generate" | "/edit" | "/video"` → 각 chip
 *   6. `pathname.startsWith("/prompt-flow/{generate,edit,video}")` → 각 mode chip 폴백
 *      (Codex 3차 보강 — 도움말 페이지에서도 mode 정체성 유지)
 *
 * 스타일: globals.css §11 (`.ais-ah-nav` + `.ais-ah-nav-link` + `data-active="true"`).
 *   inline 0 (V5 시각 본체 한정) — 활성/비활성/호버 transition 모두 CSS 책임.
 *
 * 회귀 위험 보존:
 *   - HomeBtn 흡수 (좌측 외부 버튼 X · 첫 chip 으로 통합 — 시안 v7 결정 M).
 *   - router.push 사용 (Next.js client navigation).
 */

"use client";

import { usePathname, useRouter } from "next/navigation";

/** 6 mode chip 정의 — href 와 라벨 */
const MODES: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/generate", label: "Generate" },
  { href: "/edit", label: "Edit" },
  { href: "/video", label: "Video" },
  { href: "/vision", label: "Analyze" },
  { href: "/vision/compare", label: "Compare" },
];

/**
 * 현재 pathname 에서 활성 chip href 결정.
 *
 * `/vision/compare` 가 `/vision` prefix 와 충돌하므로 *exact 우선 → prefix 폴백* 패턴.
 * 잘못된 매칭 (Compare 와 Analyze 동시 활성) 차단.
 */
function resolveActiveHref(pathname: string): string {
  // 1. exact match 우선 — Compare 같은 sub-path 가 prefix 와 충돌하지 않도록
  for (const mode of MODES) {
    if (pathname === mode.href) return mode.href;
  }
  // 2. /vision/{기타} sub-path → Analyze 폴백 (단 /vision/compare 는 위 1 단계에서 잡힘)
  if (pathname.startsWith("/vision/")) return "/vision";
  // 3. /prompt-flow/{mode} 도움말 페이지 → 해당 mode chip 활성 (Codex 3차 보강)
  //    PromptFlowShell 도 AppHeader 사용 — 도움말 페이지에서도 mode 정체성 유지.
  if (pathname.startsWith("/prompt-flow/generate")) return "/generate";
  if (pathname.startsWith("/prompt-flow/edit")) return "/edit";
  if (pathname.startsWith("/prompt-flow/video")) return "/video";
  // 4. 매칭 없음 — 메인 (/) 으로 표시 (의도하지 않은 chrome 페이지에서도 fallback)
  return "/";
}

export default function ModeNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeHref = resolveActiveHref(pathname);

  return (
    <nav className="ais-ah-nav" role="navigation" aria-label="모드 전환">
      {MODES.map((mode) => {
        const isActive = mode.href === activeHref;
        return (
          <button
            key={mode.href}
            type="button"
            className="ais-ah-nav-link"
            data-active={isActive ? "true" : undefined}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              // 이미 활성 페이지면 push 생략 (불필요 라우팅 + cursor:default 시각 일관성)
              if (isActive) return;
              router.push(mode.href);
            }}
          >
            {mode.label}
          </button>
        );
      })}
    </nav>
  );
}
