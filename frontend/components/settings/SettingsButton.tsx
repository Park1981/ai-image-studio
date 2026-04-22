/**
 * SettingsButton - gear 아이콘 + Settings Drawer 열기 트리거.
 * 각 페이지에서 기존 IconBtn(icon="gear") 대신 이 컴포넌트 사용.
 */

"use client";

import { IconBtn } from "@/components/chrome/Chrome";
import { useSettings } from "./SettingsContext";

export default function SettingsButton() {
  const { openSettings, open } = useSettings();
  return (
    <IconBtn
      icon="gear"
      title="설정 (⌘,)"
      onClick={openSettings}
      active={open}
    />
  );
}
