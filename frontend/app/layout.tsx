import type { Metadata } from "next";
import AppShell from "@/components/app/AppShell";
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
      </body>
    </html>
  );
}
