import { env } from "$amplify/env/create-billing-portal-session";

import type { Schema } from "../resource";
import { createBillingPortalSession } from "../_backend/billing";

type Handler = Schema["createBillingPortalSession"]["functionHandler"];
type BillingPortalRuntimeEnv = typeof env & {
  APP_BASE_URL?: string;
};

export const handler: Handler = async (event) => {
  // Amplify's generated env typings can lag synth-time function env wiring locally.
  const runtimeEnv = env as BillingPortalRuntimeEnv;
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
