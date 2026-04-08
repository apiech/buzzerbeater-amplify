import assert from "node:assert/strict";
import test from "node:test";

import { resolveCommercialModeEnabled } from "../lib/billing/commercial-mode";

test("commercial mode defaults to enabled when the env var is absent", () => {
  assert.equal(resolveCommercialModeEnabled({}), true);
});

test("commercial mode parses explicit false-like values as disabled", () => {
  assert.equal(
    resolveCommercialModeEnabled({
      COMMERCIAL_MODE_ENABLED: "false",
    }),
    false,
  );
  assert.equal(
    resolveCommercialModeEnabled({
      COMMERCIAL_MODE_ENABLED: "0",
    }),
    false,
  );
});
