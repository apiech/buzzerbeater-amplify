import { redirect } from "next/navigation";

import { getServerCurrentUser } from "@/app/server/amplify-server";
import { SimpleWorkspaceShell } from "@/app/workspace/simple/simple-workspace-shell";

type SimpleWorkspaceLayoutProps = {
  children: React.ReactNode;
};

export default async function SimpleWorkspaceLayout({
  children,
}: SimpleWorkspaceLayoutProps) {
  const currentUser = await getServerCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  return <SimpleWorkspaceShell>{children}</SimpleWorkspaceShell>;
}
