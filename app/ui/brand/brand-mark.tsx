import type { SVGProps } from "react";

import { cn } from "@/app/ui/primitives/cn";

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

export function BrandMark({
  className,
  title = "BuzzerBeater Assistant Coach",
  ...props
}: BrandMarkProps) {
  return (
    <svg
      aria-label={title}
      className={cn("shrink-0", className)}
      role="img"
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect x="8" y="8" width="112" height="112" rx="28" fill="#1f2a33" />
      <rect x="18" y="18" width="92" height="92" rx="22" fill="#f6efe4" />
      <path
        d="M33 34c11 8 11 52 0 60"
        fill="none"
        stroke="#2c5e81"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path
        d="M95 34c-11 8-11 52 0 60"
        fill="none"
        stroke="#2c5e81"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path
        d="M28 64h24"
        fill="none"
        stroke="#2c5e81"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <path
        d="M76 64h24"
        fill="none"
        stroke="#2c5e81"
        strokeLinecap="round"
        strokeWidth="6"
      />
      <circle cx="64" cy="64" r="24" fill="#d8834d" />
      <path
        d="M64 40v48"
        fill="none"
        stroke="#163347"
        strokeLinecap="round"
        strokeWidth="4.5"
      />
      <path
        d="M40 64h48"
        fill="none"
        stroke="#163347"
        strokeLinecap="round"
        strokeWidth="4.5"
      />
      <path
        d="M47 45c8 6 8 32 0 38"
        fill="none"
        stroke="#163347"
        strokeLinecap="round"
        strokeWidth="4.5"
      />
      <path
        d="M81 45c-8 6-8 32 0 38"
        fill="none"
        stroke="#163347"
        strokeLinecap="round"
        strokeWidth="4.5"
      />
    </svg>
  );
}
