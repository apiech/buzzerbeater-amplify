import {
  assertMaintenanceInactive as assertMaintenanceInactiveControlPlane,
  buildMaintenanceErrorMessage,
  isMaintenanceModeError,
} from "../../../lib/maintenance/control-plane";

export async function assertMaintenanceInactive(): Promise<void> {
  await assertMaintenanceInactiveControlPlane();
}

export function toMaintenanceAwareErrorMessage(error: unknown): string {
  if (isMaintenanceModeError(error)) {
    return buildMaintenanceErrorMessage(error.document);
  }

  return error instanceof Error ? error.message : String(error);
}
