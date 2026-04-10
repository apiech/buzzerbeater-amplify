import type { Metadata } from "next";

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

export default function WorkspaceSectionPage() {
  return null;
}
