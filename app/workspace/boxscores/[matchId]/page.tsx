import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  getServerCurrentUser,
} from "@/app/server/amplify-server";
import { BoxscorePageClient } from "@/app/workspace/boxscores/[matchId]/boxscore-page-client";

type BoxscorePageProps = {
  params: Promise<{
    matchId: string;
  }>;
};

export async function generateMetadata({
  params,
}: BoxscorePageProps): Promise<Metadata> {
  const { matchId } = await params;

  return {
    title: "Boxscore",
    description: `Saved boxscore for match ${matchId}.`,
  };
}

export default async function BoxscorePage({ params }: BoxscorePageProps) {
  const currentUser = await getServerCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const { matchId } = await params;

  return <BoxscorePageClient matchId={matchId} />;
}
