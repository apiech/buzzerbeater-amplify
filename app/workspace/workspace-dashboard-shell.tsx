"use client";

import { useSelectedLayoutSegment } from "next/navigation";

import { DashboardApp } from "@/app/dashboard-app";
import { normalizeWorkspaceSection } from "@/app/workspace-sections";

export function WorkspaceDashboardShell({
  commercialModeEnabled,
  viewerLabel,
}: {
  commercialModeEnabled: boolean;
  viewerLabel: string | null;
}) {
  const selectedSegment = useSelectedLayoutSegment();
  const activeSection = normalizeWorkspaceSection(selectedSegment ?? "home");

  return (
    <DashboardApp
      activeSection={activeSection}
      commercialModeEnabled={commercialModeEnabled}
      viewerLabel={viewerLabel}
    />
  );
}
