import { env } from "$amplify/env/create-billing-lifetime-checkout-session";

import type { Schema } from "../resource";
import { createBillingLifetimeCheckoutSession } from "../_backend/billing";

type Handler = Schema["createBillingLifetimeCheckoutSession"]["functionHandler"];
type BillingLifetimeCheckoutRuntimeEnv = typeof env & {
  APP_BASE_URL?: string;
  STRIPE_LIFETIME_PRICE_ID?: string;
};

export const handler: Handler = async (event) => {
  const runtimeEnv: BillingLifetimeCheckoutRuntimeEnv = env;
  const stripeSecretKey = runtimeEnv.STRIPE_SECRET_KEY;
  const lifetimePriceId = runtimeEnv.STRIPE_LIFETIME_PRICE_ID;
  const appBaseUrl = runtimeEnv.APP_BASE_URL;
  if (!stripeSecretKey || !lifetimePriceId || !appBaseUrl) {
    throw new Error(
      "Stripe lifetime checkout requires STRIPE_SECRET_KEY, STRIPE_LIFETIME_PRICE_ID, and APP_BASE_URL.",
    );
  }

  return createBillingLifetimeCheckoutSession({
    appBaseUrl,
    env: runtimeEnv,
    identity: event.identity,
    lifetimePriceId,
    returnPath: event.arguments.returnPath ?? null,
    stripeSecretKey,
  });
};
