import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "@/app/ui/primitives/cn";

type TableShellProps = HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
  tableClassName?: string;
};

export function TableShell({
  children,
  className,
  compact = false,
  tableClassName,
  ...props
}: TableShellProps) {
  return (
    <div className={cn("overflow-x-auto", className)} {...props}>
      <table
        className={cn(
          "w-full min-w-[40rem] border-collapse text-left",
          compact && "min-w-0",
          tableClassName,
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHeadCell({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-black/8 px-3 py-3 text-[0.78rem] font-bold uppercase tracking-[0.08em] text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-b border-black/8 px-3 py-3 align-top text-sm text-ink", className)} {...props} />
  );
}
