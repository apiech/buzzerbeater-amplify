import type { Metadata } from "next";

import { createPageMetadata } from "@/app/site-config";
import { Storefront } from "@/app/store/storefront";
import {
  getServerCurrentUser,
  resolveServerViewerLabel,
} from "@/app/server/amplify-server";

type StorePageProps = {
  searchParams?: Promise<{
    billing?: string | string[] | undefined;
  }>;
};

export const metadata: Metadata = createPageMetadata({
  path: "/store",
  title: "Support the Project",
  description:
    "Support the hobby project and unlock premium BuzzerBeater tools when you want deeper predictions, league writeups, and account extras.",
});

export default async function StorePage({ searchParams }: StorePageProps) {
  const currentUser = await getServerCurrentUser();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const billingValue = resolvedSearchParams?.billing;
  const billingNotice = Array.isArray(billingValue)
    ? (billingValue[0] ?? null)
    : (billingValue ?? null);

  return (
    <Storefront
      billingNotice={billingNotice}
      isSignedIn={Boolean(currentUser)}
      viewerLabel={
        currentUser ? await resolveServerViewerLabel(currentUser) : null
      }
    />
  );
}
