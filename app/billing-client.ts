"use client";

import { client } from "@/app/amplify-client";
import type { BillingSummary } from "@/app/types";

export async function fetchBillingSummary(): Promise<BillingSummary> {
  const response = await client.queries.getBillingSummary();
  if (response.errors?.length || !response.data) {
    throw new Error(formatAmplifyErrors(response.errors));
  }

  return response.data;
}

export async function createBillingCheckoutUrl(): Promise<string> {
  const response = await client.mutations.createBillingCheckoutSession();
  if (response.errors?.length || !response.data?.url) {
    throw new Error(formatAmplifyErrors(response.errors));
  }

  return response.data.url;
}

export async function createBillingPortalUrl(): Promise<string> {
  const response = await client.mutations.createBillingPortalSession();
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
