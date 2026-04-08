import { defineFunction } from "@aws-amplify/backend";

export const maintenanceAlarmTrip = defineFunction({
  resourceGroupName: "data",
  name: "maintenance-alarm-trip",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  memoryMB: 512,
});
