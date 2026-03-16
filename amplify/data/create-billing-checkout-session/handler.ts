import { env } from "$amplify/env/create-billing-checkout-session";

import type { Schema } from "../resource";
import { createBillingCheckoutSession } from "../_backend/billing";

type Handler = Schema["createBillingCheckoutSession"]["functionHandler"];

export const handler: Handler = async (event) => {
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  const premiumPriceId = env.STRIPE_PREMIUM_PRICE_ID;
  const appBaseUrl = env.APP_BASE_URL;
  if (!stripeSecretKey || !premiumPriceId || !appBaseUrl) {
    throw new Error(
      "Stripe checkout requires STRIPE_SECRET_KEY, STRIPE_PREMIUM_PRICE_ID, and APP_BASE_URL.",
    );
  }

  return createBillingCheckoutSession({
    appBaseUrl,
    env,
    identity: event.identity,
    premiumPriceId,
    stripeSecretKey,
  });
};
