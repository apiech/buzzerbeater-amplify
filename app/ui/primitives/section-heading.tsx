import type { ReactNode } from "react";

import { cn } from "@/app/ui/primitives/cn";

type SectionHeadingProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  titleAs?: "h1" | "h2" | "h3" | "h4" | "h5";
};

const titleClasses = {
  h1: "text-[clamp(2.4rem,4vw,4.4rem)] leading-none tracking-[-0.06em]",
  h2: "text-2xl leading-tight tracking-[-0.04em]",
  h3: "text-xl leading-tight tracking-[-0.03em]",
  h4: "text-lg leading-tight tracking-[-0.02em]",
  h5: "text-base leading-tight",
} as const;

export function SectionHeading({
  actions,
  className,
  description,
  eyebrow,
  title,
  titleAs = "h2",
}: SectionHeadingProps) {
  const Title = titleAs;

  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="grid gap-2">
        {eyebrow ? (
          <p className="text-[0.76rem] font-bold uppercase tracking-[0.18em] text-accent">
            {eyebrow}
          </p>
        ) : null}
        <Title className={cn("m-0 font-semibold text-ink", titleClasses[titleAs])}>
          {title}
        </Title>
        {description ? (
          <div className="max-w-[56ch] text-sm leading-7 text-ink-muted">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
