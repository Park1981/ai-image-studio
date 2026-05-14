"use client";

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";

interface ProcessingCTAProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  idleLabel: string;
  runningLabel: string;
  running: boolean;
  progress?: number | null;
  subLabel?: string | null;
  icon?: IconName;
  idleMeta?: ReactNode;
}

type ProgressStyle = CSSProperties & { "--p"?: string };

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clampProgress(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default function ProcessingCTA({
  idleLabel,
  runningLabel,
  running,
  progress,
  subLabel,
  icon = "sparkle",
  idleMeta,
  className,
  style,
  disabled,
  type = "button",
  "aria-label": ariaLabel,
  ...rest
}: ProcessingCTAProps) {
  const pct = clampProgress(progress);
  const accessibleLabel =
    ariaLabel ??
    (running
      ? `${runningLabel}${subLabel ? ` ${subLabel}` : ""} ${pct}%`
      : idleLabel);
  const mergedStyle: ProgressStyle = {
    "--p": `${pct}%`,
    ...style,
  };

  return (
    <button
      type={type}
      className={classNames("ais-processing-cta", className)}
      data-running={running ? "true" : "false"}
      aria-busy={running}
      aria-label={accessibleLabel}
      disabled={disabled}
      style={mergedStyle}
      {...rest}
    >
      <span className="ais-processing-cta-content">
        <span className="ais-processing-cta-main">
          {running ? (
            <span className="ais-processing-cta-pulse" aria-hidden />
          ) : (
            <Icon name={icon} size={15} />
          )}
          <span className="ais-processing-cta-copy">
            <span className="ais-processing-cta-title">
              {running ? runningLabel : idleLabel}
            </span>
            {running && subLabel ? (
              <span className="ais-processing-cta-sub mono">{subLabel}</span>
            ) : idleMeta ? (
              <span className="ais-processing-cta-sub mono">{idleMeta}</span>
            ) : null}
          </span>
        </span>
        {running ? (
          <span className="ais-processing-cta-percent mono">{pct}%</span>
        ) : null}
      </span>
    </button>
  );
}
