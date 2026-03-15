import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/app/ui/primitives/cn";

type StatCardProps = HTMLAttributes<HTMLElement> & {
  detail: ReactNode;
  label: ReactNode;
  value: ReactNode;
};

export function StatCard({
  className,
  detail,
  label,
  value,
  ...props
}: StatCardProps) {
  return (
    <article
      className={cn(
        "grid gap-1.5 rounded-card border border-black/5 bg-surface-strong p-4",
        className,
      )}
      {...props}
    >
      <span className="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </span>
      <strong className="text-lg leading-tight text-ink">{value}</strong>
      <span className="text-sm leading-6 text-ink-muted">{detail}</span>
    </article>
  );
}
