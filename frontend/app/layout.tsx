import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import ViewportGuard from "@/components/app/ViewportGuard";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Image Studio",
  description: "Local AI-Powered Image Generation WebUI · gemma4 + ComfyUI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* 2026-05-02: Google Fonts 직접 link (globals.css @import 가 Turbopack 컴파일에서 누락된 문제 fix).
            Fraunces ital,opsz,wght,SOFT — italic instance 명시 (시안 pair-generate.html v7 1:1).
            Noto Sans KR / JetBrains Mono 도 같이. preconnect 로 첫 글리프 fetch latency 단축. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Fraunces:ital,opsz,wght,SOFT@0,9..144,400..700,0..100;1,9..144,400..700,0..100&display=swap"
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
        {/* 2026-04-27 (UI P0-1): 1024px 미만 viewport 안내 overlay (데스크톱 전용 정책). */}
        <ViewportGuard />
      </body>
    </html>
  );
}
