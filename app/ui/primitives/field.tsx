import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "@/app/ui/primitives/cn";

type FieldProps = {
  children: ReactNode;
  className?: string;
  error?: string | null;
  hint?: ReactNode;
  htmlFor?: string;
  label: ReactNode;
};

export const fieldControlClassName =
  "w-full rounded-[1rem] border border-black/15 bg-white/90 px-4 py-3 text-sm text-ink shadow-sm outline-none transition focus:border-accent/55 focus:ring-4 focus:ring-accent/15";

export function Field({
  children,
  className,
  error,
  hint,
  htmlFor,
  label,
}: FieldProps) {
  return (
    <label className={cn("grid gap-2 font-semibold text-ink", className)} htmlFor={htmlFor}>
      <span className="text-sm">{label}</span>
      {children}
      {error ? (
        <span className="text-sm font-medium text-accent-strong">{error}</span>
      ) : hint ? (
        <span className="text-sm font-normal text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldControlClassName, className)} {...props} />;
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        fieldControlClassName,
        "appearance-none bg-[linear-gradient(45deg,transparent_50%,#1f2a33_50%),linear-gradient(135deg,#1f2a33_50%,transparent_50%)] bg-[position:calc(100%-1.4rem)_calc(50%+0.05rem),calc(100%-1rem)_calc(50%+0.05rem)] bg-[length:0.45rem_0.45rem,0.45rem_0.45rem] bg-no-repeat pr-10",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldControlClassName, "min-h-28", className)} {...props} />;
}
