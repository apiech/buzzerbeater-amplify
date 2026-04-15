import { env } from "$amplify/env/submit-product-feedback";

import type { Schema } from "../resource";
import { submitProductFeedback } from "../_backend/product-feedback";

type Handler = Schema["submitProductFeedback"]["functionHandler"];

export const handler: Handler = async (event) =>
  submitProductFeedback({
    env,
    identity: event.identity,
    kind: event.arguments.kind,
    message: event.arguments.message,
    subject: event.arguments.subject,
  });
