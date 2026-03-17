import { redirect } from "next/navigation";

import { DashboardApp } from "@/app/dashboard-app";
import {
  getServerCurrentUser,
  resolveViewerEmail,
} from "@/app/server/amplify-server";
import { normalizeWorkspaceSection } from "@/app/workspace-sections";

type WorkspaceSectionPageProps = {
  params: Promise<{
    section: string;
  }>;
};

export default async function WorkspaceSectionPage({
  params,
}: WorkspaceSectionPageProps) {
  const currentUser = await getServerCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const { section } = await params;

  return (
    <DashboardApp
      activeSection={normalizeWorkspaceSection(section)}
      viewerEmail={resolveViewerEmail(currentUser)}
    />
  );
}
