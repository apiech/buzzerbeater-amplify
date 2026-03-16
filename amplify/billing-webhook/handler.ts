import { env } from "$amplify/env/billing-webhook";

import { handleStripeWebhook } from "../data/_backend/billing";

type FunctionUrlEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  isBase64Encoded?: boolean;
};

type FunctionUrlResponse = {
  body: string;
  headers?: Record<string, string>;
  statusCode: number;
};

export const handler = async (
  event: FunctionUrlEvent,
): Promise<FunctionUrlResponse> => {
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  if (!stripeSecretKey || !webhookSecret) {
    return {
      body: JSON.stringify({ error: "Stripe webhook configuration is missing." }),
      statusCode: 500,
    };
  }

  const signatureHeader =
    event.headers?.["stripe-signature"] ?? event.headers?.["Stripe-Signature"] ?? null;
  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : (event.body ?? "");

  try {
    await handleStripeWebhook({
      body,
      env,
      signatureHeader,
      stripeSecretKey,
      webhookSecret,
    });
    return {
      body: JSON.stringify({ received: true }),
      statusCode: 200,
    };
  } catch (error) {
    console.error("Stripe webhook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      statusCode: 400,
    };
  }
};
