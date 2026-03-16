import { env } from "$amplify/env/get-billing-summary";

import type { Schema } from "../resource";
import { getBillingSummary } from "../_backend/billing";

type Handler = Schema["getBillingSummary"]["functionHandler"];

export const handler: Handler = async (event) => {
  return getBillingSummary({
    env,
    identity: event.identity,
  });
};
