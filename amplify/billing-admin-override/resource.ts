import { defineFunction, secret } from "@aws-amplify/backend";

export const billingAdminOverride = defineFunction({
  resourceGroupName: "data",
  name: "billing-admin-override",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: {
    BILLING_ADMIN_TOKEN: secret("BILLING_ADMIN_TOKEN"),
  },
});
