import { after } from "node:test";

import { __testing as maintenanceTesting } from "../lib/maintenance/control-plane";

export function installInactiveMaintenanceRuntime(): void {
  const restore = maintenanceTesting.installRuntime({
    getParameter: async () => null,
  });
  after(restore);
}
