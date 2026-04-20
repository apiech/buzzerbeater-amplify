"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
  connectionQueryOptions,
  homeWorkspaceQueryOptions,
} from "@/app/dashboard/workspace-query-client";
import { cn } from "@/app/ui/primitives/cn";

const routeTabs = [
  {
    href: "/workspace/simple/schedule",
    label: "Schedule",
    matches: (pathname: string) =>
      pathname === "/workspace/simple" ||
      pathname === "/workspace/simple/schedule",
  },
  {
    href: "/workspace/simple/prediction",
    label: "Prediction",
    matches: (pathname: string) => pathname === "/workspace/simple/prediction",
  },
] as const;

export function SimpleWorkspaceShell({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const connectionQuery = useQuery(connectionQueryOptions());
  const connected = connectionQuery.data?.status === "CONNECTED";
  const homeQuery = useQuery({
    ...homeWorkspaceQueryOptions(),
    enabled: connected,
    placeholderData: (previousData) => previousData,
  });
  const currentTeamName =
    homeQuery.data?.team.teamName ??
    connectionQuery.data?.teamName ??
    "No team connected";

  return (
    <div className="min-h-screen bg-[rgba(244,241,235,0.72)]">
      <header className="sticky top-0 z-30 border-b border-black/10 bg-[rgba(250,248,244,0.92)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-[110rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <div className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-ink-muted">
              Simple workspace
            </div>
            <div className="truncate text-sm font-semibold text-ink">
              {currentTeamName}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <nav
              aria-label="Simple workspace sections"
              className="flex items-center gap-1 rounded-lg border border-black/10 bg-white p-1"
            >
              {routeTabs.map((tab) => {
                const active = tab.matches(pathname);

                return (
                  <Link
                    key={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition",
                      active
                        ? "bg-ink text-white"
                        : "text-ink-muted hover:bg-black/5 hover:text-ink",
                    )}
                    href={tab.href}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>

            <Link
              className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-black/5"
              href="/workspace/home"
            >
              Classic workspace
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[110rem] gap-4 px-4 py-4 sm:px-6 sm:py-6">
        {children}
      </main>
    </div>
  );
}
