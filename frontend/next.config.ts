import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 좌하단 Next.js dev indicator (N 로고 + build/route 표시) 제거.
  // production 빌드엔 영향 없음 — dev 모드 표시기만 끔.
  devIndicators: false,
};

export default nextConfig;
