"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import {
  SectionAccentBar,
  type SectionAccent,
} from "@/components/studio/StudioResultHeader";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface StudioFieldHeaderProps {
  label: ReactNode;
  accent?: SectionAccent;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  htmlFor?: string;
}

export function StudioFieldHeader({
  label,
  accent = "blue",
  meta,
  action,
  className,
  htmlFor,
}: StudioFieldHeaderProps) {
  return (
    <div className={classNames("ais-field-header", className)}>
      <label className="ais-field-label ais-field-label-inline" htmlFor={htmlFor}>
        <SectionAccentBar accent={accent} />
        {label}
      </label>
      {(meta != null || action != null) && (
        <div className="ais-field-header-side">
          {meta}
          {action}
        </div>
      )}
    </div>
  );
}

interface FieldHeaderActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  active?: boolean;
  children: ReactNode;
}

export function FieldHeaderActionButton({
  icon,
  active = false,
  children,
  className,
  type = "button",
  ...rest
}: FieldHeaderActionButtonProps) {
  return (
    <button
      type={type}
      className={classNames("ais-field-action-btn", className)}
      data-active={active ? "true" : "false"}
      {...rest}
    >
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </button>
  );
}
