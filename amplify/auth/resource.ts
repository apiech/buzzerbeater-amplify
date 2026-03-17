import { defineAuth } from "@aws-amplify/backend";
import {
  LOCALHOST_APP_ORIGIN,
  resolvePublicAppOrigin,
} from "../../lib/env/public-app-origin.js";

const appBaseUrl = resolvePublicAppOrigin(process.env, {
  fallback: LOCALHOST_APP_ORIGIN,
});

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
