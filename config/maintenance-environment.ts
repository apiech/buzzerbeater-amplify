import { resolveMaintenanceEnvironmentName } from "@/lib/maintenance/environment";

export const maintenanceEnvironmentName = resolveMaintenanceEnvironmentName(
  process.env,
);
