import type { HTMLAttributes } from "react";

import { cn } from "@/app/ui/primitives/cn";

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "danger" | "neutral" | "note" | "success";
};

const toneClasses = {
  neutral: "border-black/10 bg-black/5 text-ink",
  success: "border-success/20 bg-success/10 text-success",
  danger: "border-danger-border bg-danger-bg text-accent-strong",
  note: "border-note-border bg-note-bg text-note",
} as const;

export function StatusBadge({
  children,
  className,
  tone = "neutral",
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-10 items-center justify-center rounded-full border px-3.5 py-2 text-sm font-semibold",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function statusToneFromValue(status: string | null | undefined) {
  const normalized = status?.toLowerCase();

  if (!normalized) {
    return "neutral" as const;
  }

  if (["connected", "succeeded"].includes(normalized)) {
    return "success" as const;
  }

  if (["error", "failed", "invalid", "disconnected"].includes(normalized)) {
    return "danger" as const;
  }

  if (["queued", "running", "pending"].includes(normalized)) {
    return "note" as const;
  }

  return "neutral" as const;
}
