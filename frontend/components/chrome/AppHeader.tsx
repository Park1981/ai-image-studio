/**
 * AppHeader — 모든 페이지 공용 통합 헤더.
 *
 * 라우트 자동 분기 (usePathname):
 *   "/"               → 메인. HomeBtn 숨김 (이미 메인이니까).
 *   "/generate" 등    → 메뉴 페이지. HomeBtn 표시.
 *
 * 우측 영역 순서 (오빠 결정 7):
 *   [SystemStatusChip][SystemMetrics][SettingsButton]
 *
 * 2026-04-26 신설 — 6 페이지가 동일한 TopBar 패턴 5번 반복하던 걸 한 줄로 통합.
 *   각 페이지는 <AppHeader /> 한 줄만 호출.
 *
 * 2026-04-30 (Phase 3.3 · refactor doc §R1):
 *   ShutdownBtn / ShutdownOverlay / shutdownModalButton 3 함수 (~310줄) 를
 *   ShutdownButton.tsx 로 분리 → 이 파일은 헤더 composition 위주.
 */

"use client";

import { usePathname, useRouter } from "next/navigation";
import { Logo, TopBar } from "./Chrome";
import SettingsButton from "@/components/settings/SettingsButton";
import SystemMetrics from "./SystemMetrics";
import SystemStatusChip from "./SystemStatusChip";
import ShutdownButton from "./ShutdownButton";
import Icon from "@/components/ui/Icon";
import { USE_MOCK } from "@/lib/api/client";

/** 홈 아이콘 버튼 — 메뉴 페이지 좌측 상단 (BackBtn 자리 대체).
 *  icon-only · tooltip "메인으로" · 단축키 없음 (Esc 충돌 회피).
 */
function HomeBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="메인으로"
      aria-label="메인으로"
      style={{
        all: "unset",
        cursor: "pointer",
        width: 32,
        height: 32,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--surface)",
        color: "var(--ink-2)",
        display: "grid",
        placeItems: "center",
        transition: "all .15s",
      }}
      onMouseEnter={(e) => {
        const t = e.currentTarget as HTMLButtonElement;
        t.style.borderColor = "var(--line-2)";
        t.style.background = "var(--bg-2)";
        t.style.color = "var(--ink)";
      }}
      onMouseLeave={(e) => {
        const t = e.currentTarget as HTMLButtonElement;
        t.style.borderColor = "var(--line)";
        t.style.background = "var(--surface)";
        t.style.color = "var(--ink-2)";
      }}
    >
      <Icon name="home" size={15} />
    </button>
  );
}

function MockModeBadge() {
  if (!USE_MOCK) return null;

  return (
    <div
      role="status"
      title="NEXT_PUBLIC_USE_MOCK=true"
      style={{
        display: "flex",
        alignItems: "center",
        height: 26,
        padding: "0 9px",
        borderRadius: "var(--radius-full)",
        border: "1px solid rgba(245,158,11,.42)",
        background: "rgba(245,158,11,.10)",
        color: "var(--amber-ink)",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: ".06em",
        whiteSpace: "nowrap",
      }}
    >
      MOCK
    </div>
  );
}

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();

  // 메인 페이지는 HomeBtn 숨김
  const showHomeBtn = pathname !== "/";

  return (
    <TopBar
      left={
        showHomeBtn ? (
          <>
            <HomeBtn onClick={() => router.push("/")} />
            <Logo />
          </>
        ) : (
          <Logo />
        )
      }
      right={
        <>
          <MockModeBadge />
          <SystemStatusChip />
          <SystemMetrics />
          <SettingsButton />
          <ShutdownButton />
        </>
      }
    />
  );
}
