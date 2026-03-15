"use client";

import Link from "next/link";

import { cn } from "@/app/ui/primitives/cn";
import {
  workspaceSections,
  type WorkspaceSection,
} from "@/app/workspace-sections";

export function WorkspaceRouteNav({
  activeSection,
}: {
  activeSection: WorkspaceSection;
}) {
  return (
    <nav
      aria-label="Workspace sections"
      className="grid gap-3 md:grid-cols-3"
    >
      {workspaceSections.map((section) => {
        const active = activeSection === section.id;

        return (
          <Link
            key={section.id}
            aria-current={active ? "page" : undefined}
            className={cn(
              "grid gap-1 rounded-card border px-4 py-4 transition duration-150",
              active
                ? "border-accent/30 bg-accent/10"
                : "border-black/10 bg-white/70 hover:-translate-y-px hover:border-accent/25 hover:bg-white/90",
            )}
            href={`/workspace/${section.id}`}
          >
            <span className="font-semibold text-ink">{section.label}</span>
            <span className="text-sm leading-5 text-ink-muted">
              {section.description}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
