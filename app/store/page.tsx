import { Storefront } from "@/app/store/storefront";
import {
  getServerCurrentUser,
  resolveViewerEmail,
} from "@/app/server/amplify-server";

type StorePageProps = {
  searchParams?: Promise<{
    billing?: string | string[] | undefined;
  }>;
};

export default async function StorePage({ searchParams }: StorePageProps) {
  const currentUser = await getServerCurrentUser();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const billingValue = resolvedSearchParams?.billing;
  const billingNotice = Array.isArray(billingValue)
    ? billingValue[0] ?? null
    : billingValue ?? null;

  return (
    <Storefront
      billingNotice={billingNotice}
      isSignedIn={Boolean(currentUser)}
      viewerEmail={currentUser ? resolveViewerEmail(currentUser) : null}
    />
  );
}
