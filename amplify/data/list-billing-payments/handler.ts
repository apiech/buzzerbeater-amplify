import { env } from "$amplify/env/list-billing-payments";

import type { Schema } from "../resource";
import { listBillingPayments } from "../_backend/billing";

type Handler = Schema["listBillingPayments"]["functionHandler"];

export const handler: Handler = async (event) => {
  return listBillingPayments({
    env,
    identity: event.identity,
    limit: event.arguments.limit ?? null,
    nextToken: event.arguments.nextToken ?? null,
  });
};
