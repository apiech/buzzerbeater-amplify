import { env } from "$amplify/env/maintenance-admin";
import { z } from "zod";

import {
  activateMaintenance,
  clearMaintenance,
  getMaintenanceState,
} from "../../lib/maintenance/control-plane";

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

const activateRequestSchema = z.object({
  action: z.enum(["activate", "update-message"]),
  activatedBy: z.string().trim().min(1).max(120).optional(),
  detail: z.string().trim().min(1).max(4_000).optional(),
  expectedRecoveryAt: z.string().datetime().nullable().optional(),
  headline: z.string().trim().min(1).max(160).optional(),
  reasonCode: z
    .enum([
      "MANUAL",
      "BUDGET_GUARDRAIL",
      "LLM_OUTAGE",
      "BB_API_OUTAGE",
      "DEPENDENCY_OUTAGE",
    ])
    .optional(),
});
const clearRequestSchema = z.object({
  action: z.literal("clear"),
});
const maintenanceRequestSchema = z.union([
  activateRequestSchema,
  clearRequestSchema,
]);

export const handler = async (
  event: FunctionUrlEvent,
): Promise<FunctionUrlResponse> => {
  const method = event.requestContext?.http?.method ?? "POST";
  if (method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const configuredToken = env.MAINTENANCE_ADMIN_TOKEN?.trim();
  const providedToken = readBearerToken(event.headers);
  if (!configuredToken || !providedToken || configuredToken !== providedToken) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    const request = maintenanceRequestSchema.parse(JSON.parse(body || "{}"));

    if (request.action === "clear") {
      const state = await clearMaintenance(env);
      return jsonResponse(200, {
        action: request.action,
        changed: true,
        state,
      });
    }

    const existingState = await getMaintenanceState(env);
    const fallbackDocument =
      request.action === "update-message" ? existingState.document : null;
    const headline = request.headline?.trim() || fallbackDocument?.headline;
    const detail = request.detail?.trim() || fallbackDocument?.detail;
    const reasonCode =
      request.reasonCode ?? fallbackDocument?.reasonCode ?? null;
    const expectedRecoveryAt =
      request.expectedRecoveryAt !== undefined
        ? request.expectedRecoveryAt
        : (fallbackDocument?.expectedRecoveryAt ?? null);

    if (!headline) {
      throw new Error("headline is required for activate and update-message.");
    }
    if (!detail) {
      throw new Error("detail is required for activate and update-message.");
    }
    if (!reasonCode) {
      throw new Error(
        "reasonCode is required for activate and update-message.",
      );
    }

    const result = await activateMaintenance({
      activatedBy:
        request.activatedBy?.trim() ||
        fallbackDocument?.activatedBy ||
        "maintenance-admin",
      detail,
      env,
      expectedRecoveryAt,
      headline,
      reasonCode,
      source: "MANUAL",
    });

    return jsonResponse(200, {
      action: request.action,
      changed: result.changed,
      state: result.state,
    });
  } catch (error) {
    return jsonResponse(400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

function jsonResponse(
  statusCode: number,
  payload: Record<string, unknown>,
): FunctionUrlResponse {
  return {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
    },
    statusCode,
  };
}

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
