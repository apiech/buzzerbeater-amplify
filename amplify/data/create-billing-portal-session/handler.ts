import { env } from "$amplify/env/create-billing-portal-session";

import type { Schema } from "../resource";
import { createBillingPortalSession } from "../_backend/billing";

type Handler = Schema["createBillingPortalSession"]["functionHandler"];

export const handler: Handler = async (event) => {
  const runtimeEnv = env;
  const stripeSecretKey = runtimeEnv.STRIPE_SECRET_KEY;
  const appBaseUrl = runtimeEnv.APP_BASE_URL;
  if (!stripeSecretKey || !appBaseUrl) {
    throw new Error(
      "Stripe billing portal requires STRIPE_SECRET_KEY and APP_BASE_URL.",
    );
  }

  return createBillingPortalSession({
    appBaseUrl,
    env: runtimeEnv,
    identity: event.identity,
    returnPath: event.arguments.returnPath ?? null,
    stripeSecretKey,
  });
};
