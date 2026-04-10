import { redirect } from "next/navigation";

import { commercialModeEnabled } from "@/config/commercial-mode";
import {
  getServerCurrentUser,
  resolveServerViewerLabel,
} from "@/app/server/amplify-server";
import { WorkspaceDashboardShell } from "@/app/workspace/workspace-dashboard-shell";

type DashboardLayoutProps = {
  children: React.ReactNode;
};

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const currentUser = await getServerCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  return (
    <>
      <WorkspaceDashboardShell
        commercialModeEnabled={commercialModeEnabled}
        viewerLabel={await resolveServerViewerLabel(currentUser)}
      />
      {children}
    </>
  );
}
