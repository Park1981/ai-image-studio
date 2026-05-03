/**
 * Icon - 수기(手記) 느낌의 라인 아이콘 세트
 * Claude Design handoff 의 icons.jsx 를 TypeScript 포팅
 * mono-weight, square style, 24x24 viewBox 기준
 */

import type { CSSProperties } from "react";

export type IconName =
  | "gear"
  | "image"
  | "edit"
  | "film"
  | "arrow-left"
  | "arrow-right"
  | "chevron-down"
  | "chevron-right"
  | "sparkle"
  | "search"
  | "scan-eye"
  | "upload"
  | "check"
  | "clock"
  | "grid"
  | "zoom-in"
  | "download"
  | "refresh"
  | "cpu"
  | "copy"
  | "x"
  | "dot"
  | "wand"
  | "lock"
  | "unlock"
  | "play"
  | "compare"
  | "upscale"
  | "home"
  | "power"
  | "dots-grid"
  | "stars"
  | "bolt"
  | "flame";

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
  className?: string;
}

export default function Icon({ name, size = 16, stroke = 1.5, style, className }: IconProps) {
  // 공통 SVG 속성
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
    className,
  };

  switch (name) {
    case "gear":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
    case "image":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="1.5" />
          <path d="m21 15-4.5-4.5L6 21" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );
    case "film":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 8h18M3 16h18M8 3v18M16 3v18" />
        </svg>
      );
    case "play":
      // 재생 — 원형 테두리 + 중앙 플레이 삼각형 (mono-weight 라인 스타일)
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5v7l6-3.5z" />
        </svg>
      );
    case "compare":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="7" height="14" rx="1.5" />
          <rect x="14" y="5" width="7" height="14" rx="1.5" />
          <path d="M10 12h4" />
          <path d="m12 9 3 3-3 3" />
        </svg>
      );
    case "upscale":
      // 업스케일 — 좌하단 픽셀 그리드(저해상도) + 우상단 대각선 화살표(고해상도)
      // 그리드 일부는 opacity 0.4 로 입체감
      return (
        <svg {...common}>
          <rect x="3" y="17" width="4" height="4" fill="currentColor" stroke="none" />
          <rect x="7" y="13" width="4" height="4" fill="currentColor" stroke="none" />
          <rect x="3" y="13" width="4" height="4" fill="currentColor" stroke="none" opacity={0.4} />
          <rect x="7" y="17" width="4" height="4" fill="currentColor" stroke="none" opacity={0.4} />
          <rect x="11" y="17" width="4" height="4" fill="currentColor" stroke="none" opacity={0.4} />
          <path d="M12 12 L20 4" />
          <polyline points="15 4 20 4 20 9" />
        </svg>
      );
    case "home":
      // 홈 — 박공 지붕 + 박스 + 작은 문 (메뉴 페이지 ← 메인 BackBtn 신규 디자인)
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...common}>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...common}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <path d="m5.6 5.6 2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      );
    case "scan-eye":
      return (
        <svg {...common}>
          <path d="M7 3H5a2 2 0 0 0-2 2v2M17 3h2a2 2 0 0 1 2 2v2M7 21H5a2 2 0 0 1-2-2v-2M17 21h2a2 2 0 0 0 2-2v-2" />
          <path d="M4.5 12s2.6-4 7.5-4 7.5 4 7.5 4-2.6 4-7.5 4-7.5-4-7.5-4Z" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M17 8l-5-5-5 5" />
          <path d="M12 3v12" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case "zoom-in":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 10 5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      );
    case "cpu":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case "dot":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      );
    case "wand":
      return (
        <svg {...common}>
          <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M17.8 6.2l1.4-1.4" />
          <path d="m3 21 9-9" />
          <path d="m12.5 11.5 3 3" />
        </svg>
      );
    // 자물쇠 — 비율 잠금 토글에 사용
    case "lock":
      return (
        <svg {...common}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case "unlock":
      return (
        <svg {...common}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0" />
        </svg>
      );
    // 전원 — 종료 버튼 (시안 pair-generate.html v7 매치)
    // 위 막대 + 아래 둥근 호 (universal power 심볼)
    case "power":
      return (
        <svg {...common}>
          <path d="M12 2v10" />
          <path d="M5.5 7.5a8 8 0 1 0 13 0" />
        </svg>
      );
    // 4개 점 — mode-flow-link (도움말/흐름 보기). 시안 pair-generate.html v7 매치.
    // 4 모서리 작은 원 (도넛형 stroke). grid 아이콘 (4 사각형) 과 시각적으로 구분.
    case "dots-grid":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
      );
    // 별 두 개 — AI 보정 카드 icon-box (시안 pair-generate.html v7 sparkle stars).
    // 큰 다이아몬드 별 + 작은 다이아몬드 별. 기존 sparkle (4방향 광선) 과 시각 구분.
    case "stars":
      return (
        <svg {...common}>
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
          <path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9z" />
        </svg>
      );
    // 번개 — 퀄리티/빠른 모드 카드 icon-box (시안 pair-generate.html v7 lightning bolt).
    case "bolt":
      return (
        <svg {...common}>
          <path d="M6 3h12l4 6-10 13L2 9Z" />
          <path d="M2 9h20" />
          <path d="M9 9l3-6 3 6" />
        </svg>
      );
    // 불꽃 — 성인 모드 카드 icon-box (Video 전용 · crimson 시그니처와 매칭).
    case "flame":
      return (
        <svg {...common}>
          <path d="M12 2c-1 3-3 5-3 8a4 4 0 0 0 8 0c0-2-2-4-2-6 0 2-1 3-2 3 0-2 0-3-1-5z" />
          <path d="M11 14a2 2 0 0 0 2 2 2 2 0 0 0 0-4c-1 1-2 1-2 2z" />
        </svg>
      );
    default:
      return null;
  }
}
