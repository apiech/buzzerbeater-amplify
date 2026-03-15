import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/app/ui/primitives/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
};

const variantClasses = {
  primary:
    "border-accent bg-accent text-accent-contrast shadow-sm hover:border-accent-strong hover:bg-accent-strong",
  secondary:
    "border-border-soft bg-white/70 text-ink shadow-sm hover:-translate-y-px hover:border-accent/35 hover:bg-white/90",
  ghost:
    "border-transparent bg-transparent text-ink-muted hover:border-border-soft hover:bg-white/45 hover:text-ink",
} as const;

const sizeClasses = {
  sm: "min-h-9 px-3.5 text-xs",
  md: "min-h-11 px-4 py-2.5 text-sm",
} as const;

export function Button({
  children,
  className,
  disabled,
  loading = false,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full border font-semibold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-60",
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      <span>{children}</span>
    </button>
  );
}
