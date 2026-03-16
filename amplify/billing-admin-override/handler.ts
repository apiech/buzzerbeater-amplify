import { env } from "$amplify/env/billing-admin-override";

import { setBillingOverride } from "../data/_backend/billing";

type FunctionUrlEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
};

type FunctionUrlResponse = {
  body: string;
  headers?: Record<string, string>;
  statusCode: number;
};

type OverrideRequest = {
  overrideExpiresAt?: string | null;
  overrideReason?: string | null;
  planId?: "free" | "premium" | null;
  userId?: string;
};

export const handler = async (
  event: FunctionUrlEvent,
): Promise<FunctionUrlResponse> => {
  const method = event.requestContext?.http?.method ?? "POST";
  if (method !== "POST") {
    return {
      body: JSON.stringify({ error: "Method not allowed." }),
      statusCode: 405,
    };
  }

  const configuredToken = env.BILLING_ADMIN_TOKEN?.trim();
  const providedToken = readBearerToken(event.headers);
  if (!configuredToken || !providedToken || configuredToken !== providedToken) {
    return {
      body: JSON.stringify({ error: "Unauthorized." }),
      statusCode: 401,
    };
  }

  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    const request = JSON.parse(body || "{}") as OverrideRequest;
    const userId = request.userId?.trim();
    if (!userId) {
      throw new Error("userId is required.");
    }

    const summary = await setBillingOverride({
      env,
      overrideExpiresAt: request.overrideExpiresAt ?? null,
      overrideReason: request.overrideReason ?? null,
      planId: request.planId ?? null,
      userId,
    });

    return {
      body: JSON.stringify({
        billingSummary: summary,
        userId,
      }),
      statusCode: 200,
    };
  } catch (error) {
    return {
      body: JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      statusCode: 400,
    };
  }
};

function readBearerToken(
  headers: Record<string, string | undefined> | undefined,
): string | null {
  const rawValue = headers?.authorization ?? headers?.Authorization ?? null;
  if (!rawValue?.startsWith("Bearer ")) {
    return null;
  }

  const token = rawValue.slice("Bearer ".length).trim();
  return token || null;
}
