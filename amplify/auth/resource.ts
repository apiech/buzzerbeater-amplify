import { defineAuth } from "@aws-amplify/backend";

const appBaseUrl = (
  process.env.APP_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

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
