"use client";

import { client } from "@/app/amplify-client";
import type { BillingPaymentsPage, BillingSummary } from "@/app/types";

export async function fetchBillingSummary(): Promise<BillingSummary> {
  const response = await client.queries.getBillingSummary();
  if (response.errors?.length || !response.data) {
    throw new Error(formatAmplifyErrors(response.errors));
  }

  return response.data;
}

export async function fetchBillingPayments(input?: {
  limit?: number;
  nextToken?: string | null;
}): Promise<BillingPaymentsPage> {
  const response = await client.queries.listMyBillingPayments(input);
  if (response.errors?.length || !response.data) {
    throw new Error(formatAmplifyErrors(response.errors));
  }

  return response.data;
}

export async function createBillingCheckoutUrl(returnPath?: string): Promise<string> {
  const response = await client.mutations.createBillingCheckoutSession(
    returnPath ? { returnPath } : undefined,
  );
  if (response.errors?.length || !response.data?.url) {
    throw new Error(formatAmplifyErrors(response.errors));
  }

  return response.data.url;
}

export async function createBillingLifetimeCheckoutUrl(
  returnPath?: string,
): Promise<string> {
  const response = await client.mutations.createBillingLifetimeCheckoutSession(
    returnPath ? { returnPath } : undefined,
  );
  if (response.errors?.length || !response.data?.url) {
    throw new Error(formatAmplifyErrors(response.errors));
  }

  return response.data.url;
}

export async function createBillingPortalUrl(returnPath?: string): Promise<string> {
  const response = await client.mutations.createBillingPortalSession(
    returnPath ? { returnPath } : undefined,
  );
  if (response.errors?.length || !response.data?.url) {
    throw new Error(formatAmplifyErrors(response.errors));
  }

  return response.data.url;
}

function formatAmplifyErrors(
  errors: Array<{ message?: string }> | null | undefined,
): string {
  if (!errors?.length) {
    return "The billing request failed without a detailed error message.";
  }

  return errors
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
}
