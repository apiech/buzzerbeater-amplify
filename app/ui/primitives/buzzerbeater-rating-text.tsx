import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/app/ui/primitives/cn";
import {
  buzzerBeaterColorStyle,
  type BuzzerBeaterScaleId,
} from "@/lib/buzzerbeater/rating-scale";

type BuzzerBeaterRatingTextProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  label?: string | null;
  scale: BuzzerBeaterScaleId;
  value?: number | null;
};

export function BuzzerBeaterRatingText({
  children,
  className,
  label,
  scale,
  style,
  value,
  ...props
}: BuzzerBeaterRatingTextProps) {
  const ratingStyle = buzzerBeaterColorStyle({ scale, label, value });
  return (
    <span
      className={cn(
        ratingStyle ? "text-[color:var(--bb-rating-color)]" : null,
        className,
      )}
      style={ratingStyle ? { ...ratingStyle, ...style } : style}
      {...props}
    >
      {children}
    </span>
  );
}
