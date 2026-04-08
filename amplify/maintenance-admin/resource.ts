import { defineFunction, secret } from "@aws-amplify/backend";

export const maintenanceAdmin = defineFunction({
  resourceGroupName: "data",
  name: "maintenance-admin",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: {
    MAINTENANCE_ADMIN_TOKEN: secret("MAINTENANCE_ADMIN_TOKEN"),
  },
});
