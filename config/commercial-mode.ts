import { resolveCommercialModeEnabled } from "@/lib/billing/commercial-mode";

export const commercialModeEnabled = resolveCommercialModeEnabled({
  COMMERCIAL_MODE_ENABLED: process.env.COMMERCIAL_MODE_ENABLED,
});
