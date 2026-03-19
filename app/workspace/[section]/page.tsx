import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardApp } from "@/app/dashboard-app";
import {
  getServerCurrentUser,
  resolveViewerEmail,
} from "@/app/server/amplify-server";
import {
  normalizeWorkspaceSection,
  workspaceSections,
} from "@/app/workspace-sections";

type WorkspaceSectionPageProps = {
  params: Promise<{
    section: string;
  }>;
};

export async function generateMetadata({
  params,
}: WorkspaceSectionPageProps): Promise<Metadata> {
  const { section } = await params;
  const normalizedSection = normalizeWorkspaceSection(section);
  const currentSection =
    workspaceSections.find((entry) => entry.id === normalizedSection) ??
    workspaceSections[0];

  return {
    title: currentSection.label,
    description: currentSection.description,
  };
}

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
