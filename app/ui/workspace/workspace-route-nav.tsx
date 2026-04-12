"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/app/ui/primitives/cn";
import { workspaceSections, type WorkspaceSection } from "@/app/workspace-sections";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

type WorkspaceRouteNavProps = {
  activeSection: WorkspaceSection;
  accountActions?: ReactNode;
  currentTeamName?: string | null;
  currentTeamRecord?: string | null;
  nextOpponentName?: string | null;
  secondaryActions?: ReactNode;
};

export function WorkspaceRouteNav({
  activeSection,
  accountActions,
  currentTeamName,
  currentTeamRecord,
  nextOpponentName,
  secondaryActions,
}: WorkspaceRouteNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const groupedSections = groupSections();

  function setMobileMenuOpen(nextValue: boolean) {
    setMobileOpen((currentValue) => {
      if (currentValue === nextValue) {
        return currentValue;
      }

      captureAnalyticsEvent("workspace_nav_menu_toggled", {
        navigation_surface: "mobile_drawer",
        state: nextValue ? "opened" : "closed",
      });
      return nextValue;
    });
  }

  function handleSectionNavigation(
    destinationSection: WorkspaceSection,
    navigationSurface: "desktop_sidebar" | "mobile_drawer",
  ) {
    captureAnalyticsEvent("workspace_nav_clicked", {
      destination_section: destinationSection,
      from_section: activeSection,
      navigation_surface: navigationSurface,
    });

    if (navigationSurface === "mobile_drawer") {
      setMobileMenuOpen(false);
    }
  }

  function renderSidebarContent(
    navigationSurface: "desktop_sidebar" | "mobile_drawer",
  ) {
    return (
      <div className="grid gap-6">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <p className="text-[0.76rem] font-bold uppercase tracking-[0.18em] text-accent">
              BuzzerBeater Assistant Coach
            </p>
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.05em] text-ink">
              Current team first
            </h1>
          </div>
          <p className="m-0 text-sm leading-6 text-ink-muted">
            Prep your club, read opponents, and keep league context close at hand.
          </p>
        </div>

        <div className="grid gap-3 rounded-panel border border-border-soft bg-surface-strong p-4">
          <p className="m-0 text-[0.76rem] font-bold uppercase tracking-[0.18em] text-accent">
            Current team
          </p>
          <div className="grid gap-1">
            <strong className="text-base text-ink">
              {currentTeamName ?? "Waiting for your club"}
            </strong>
            <span className="text-sm text-ink-muted">
              {currentTeamRecord ?? "Your active club appears here after sync."}
            </span>
          </div>
          <span className="text-sm text-ink-muted">
            Next opponent: {nextOpponentName ?? "Not available yet"}
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
            Team switching can slot in here when multi-club support lands.
          </span>
        </div>

        <nav aria-label="Primary" className="grid gap-5">
          {groupedSections.map(([group, sections]) => (
            <div className="grid gap-2" key={group}>
              <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-ink-muted">
                {group}
              </p>
              <div className="grid gap-2">
                {sections.map((section) => {
                  const active = activeSection === section.id;

                  return (
                    <Link
                      key={section.id}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "grid gap-1 rounded-card border px-4 py-3 transition duration-150",
                        active
                          ? "border-accent/35 bg-accent/12 shadow-sm"
                          : "border-black/8 bg-white/45 hover:-translate-y-px hover:border-accent/20 hover:bg-white/70",
                      )}
                      href={`/workspace/${section.id}`}
                      onClick={() =>
                        handleSectionNavigation(section.id, navigationSurface)
                      }
                    >
                      <span className="font-semibold text-ink">{section.label}</span>
                      <span className="text-sm leading-5 text-ink-muted">
                        {section.description}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {secondaryActions ? (
          <div className="grid gap-3 rounded-panel border border-border-soft bg-surface p-4">
            {secondaryActions}
          </div>
        ) : null}

        {accountActions ? (
          <div className="grid gap-3 rounded-panel border border-border-soft bg-surface p-4">
            {accountActions}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <div className="grid gap-1">
          <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-accent">
            BuzzerBeater Assistant Coach
          </p>
          <strong className="text-base text-ink">
            {currentTeamName ?? "Team menu"}
          </strong>
        </div>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-soft bg-surface-strong px-4 text-sm font-semibold text-ink shadow-sm"
          onClick={() => setMobileMenuOpen(true)}
          type="button"
        >
          Menu
        </button>
      </div>

      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/35 transition lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setMobileMenuOpen(false)}
      >
        <aside
          className={cn(
            "absolute inset-y-0 left-0 w-[min(24rem,90vw)] overflow-y-auto border-r border-border-soft bg-surface p-5 shadow-panel transition duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-4 flex justify-end">
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-soft px-4 text-sm font-semibold text-ink"
              onClick={() => setMobileMenuOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
          {renderSidebarContent("mobile_drawer")}
        </aside>
      </div>

      <aside className="sticky top-4 hidden max-h-[calc(100vh-2rem)] overflow-y-auto lg:block">
        <PanelShell>{renderSidebarContent("desktop_sidebar")}</PanelShell>
      </aside>
    </>
  );
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-panel border border-border-soft bg-surface p-5 shadow-panel backdrop-blur-xl">
      {children}
    </div>
  );
}

function groupSections() {
  const groups = new Map<string, Array<(typeof workspaceSections)[number]>>();

  for (const section of workspaceSections) {
    const current = groups.get(section.group) ?? [];
    groups.set(section.group, [...current, section]);
  }

  return Array.from(groups.entries());
}
