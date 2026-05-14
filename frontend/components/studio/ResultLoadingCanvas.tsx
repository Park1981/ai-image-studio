"use client";

import type { ComponentPropsWithoutRef } from "react";

type ResultLoadingVariant = "hero" | "plain";

interface ResultLoadingCanvasProps extends ComponentPropsWithoutRef<"div"> {
  variant?: ResultLoadingVariant;
  modifier?: "edit";
  label?: string;
  showLabel?: boolean;
}

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function ResultLoadingCanvas({
  variant = "hero",
  modifier,
  label = "처리 중…",
  showLabel = true,
  className,
  ...rest
}: ResultLoadingCanvasProps) {
  return (
    <div
      className={classNames(
        "ais-result-state-shell",
        "ais-result-loading-canvas",
        className,
      )}
      data-testid="result-box-loading-placeholder"
      data-result-loading-variant={variant}
      data-result-loading-modifier={modifier ?? "none"}
      role="status"
      aria-live="polite"
      {...rest}
    >
      {showLabel && (
        <div className="ais-result-loading-caption mono">{label}</div>
      )}
    </div>
  );
}
