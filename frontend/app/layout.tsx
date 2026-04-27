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
      <body>
        <AppShell>{children}</AppShell>
        {/* 2026-04-27 (UI P0-1): 1024px 미만 viewport 안내 overlay (데스크톱 전용 정책). */}
        <ViewportGuard />
      </body>
    </html>
  );
}
