import { DashboardApp } from "@/app/dashboard-app";
import { normalizeWorkspaceSection } from "@/app/workspace-sections";

type WorkspaceSectionPageProps = {
  params: Promise<{
    section: string;
  }>;
};

export default async function WorkspaceSectionPage({
  params,
}: WorkspaceSectionPageProps) {
  const { section } = await params;

  return <DashboardApp activeSection={normalizeWorkspaceSection(section)} />;
}
