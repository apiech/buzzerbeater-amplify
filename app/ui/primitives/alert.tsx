import type { HTMLAttributes } from "react";

import { cn } from "@/app/ui/primitives/cn";

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "danger" | "note";
};

const toneClasses = {
  danger: "border-danger-border bg-danger-bg text-accent-strong",
  note: "border-note-border bg-note-bg text-note",
} as const;

export function Alert({
  children,
  className,
  tone = "danger",
  ...props
}: AlertProps) {
  return (
    <div
      className={cn(
        "rounded-[1rem] border px-4 py-3 text-sm leading-6",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
