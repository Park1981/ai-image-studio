import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
import "./globals.css";

// Pretendard Variable + JetBrains Mono 은 globals.css 에서 CDN/로컬 폰트 로드
// next/font 대신 link preload 방식을 layout 에서 사용

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
        {/* 한글 우선 타이포그래피: Pretendard + Noto Sans KR */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..700,0..100,0..1&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css"
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
