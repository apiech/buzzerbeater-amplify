import type { HTMLAttributes } from "react";

import { cn } from "@/app/ui/primitives/cn";

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: "article" | "div" | "section";
  padding?: "lg" | "md" | "sm";
  variant?: "danger" | "glass" | "solid";
};

const paddingClasses = {
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
} as const;

const variantClasses = {
  glass: "border border-border-soft bg-surface shadow-panel backdrop-blur-xl",
  solid: "border border-black/5 bg-surface-strong",
  danger: "border border-danger-border bg-surface shadow-panel backdrop-blur-xl",
} as const;

export function Panel({
  as = "section",
  className,
  padding = "md",
  variant = "glass",
  ...props
}: PanelProps) {
  const Component = as;

  return (
    <Component
      className={cn(
        "flex flex-col gap-4 rounded-panel",
        paddingClasses[padding],
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
