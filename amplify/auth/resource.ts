import { defineAuth } from "@aws-amplify/backend";

import { resolveAuthAppOrigin } from "../_shared/synth-env.js";

const appBaseUrl = resolveAuthAppOrigin();

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      callbackUrls: [`${appBaseUrl}/api/auth/sign-in-callback`],
      logoutUrls: [`${appBaseUrl}/api/auth/sign-out-callback`],
    },
  },
});
