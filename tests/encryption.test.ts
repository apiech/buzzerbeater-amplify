import assert from "node:assert/strict";
import test from "node:test";

import { getEncryptionSecret } from "../amplify/data/_backend/encryption";

test("getEncryptionSecret returns the configured secret when present", () => {
  assert.equal(
    getEncryptionSecret({ BB_CONNECTION_ENCRYPTION_SECRET: "configured-secret" }),
    "configured-secret",
  );
});

test("getEncryptionSecret throws when no secret is configured", (t) => {
  const originalSecret = process.env.BB_CONNECTION_ENCRYPTION_SECRET;
  const originalBypass = process.env.ALLOW_INSECURE_LOCAL_BB_CONNECTION_SECRET;
  t.after(() => {
    restoreEnvValue("BB_CONNECTION_ENCRYPTION_SECRET", originalSecret);
    restoreEnvValue("ALLOW_INSECURE_LOCAL_BB_CONNECTION_SECRET", originalBypass);
  });
  delete process.env.BB_CONNECTION_ENCRYPTION_SECRET;
  delete process.env.ALLOW_INSECURE_LOCAL_BB_CONNECTION_SECRET;

  assert.throws(
    () => getEncryptionSecret({}),
    /BB_CONNECTION_ENCRYPTION_SECRET is not configured\./,
  );
});

test("getEncryptionSecret allows the insecure local fallback only when explicitly enabled", (t) => {
  const originalSecret = process.env.BB_CONNECTION_ENCRYPTION_SECRET;
  const originalBypass = process.env.ALLOW_INSECURE_LOCAL_BB_CONNECTION_SECRET;
  t.after(() => {
    restoreEnvValue("BB_CONNECTION_ENCRYPTION_SECRET", originalSecret);
    restoreEnvValue("ALLOW_INSECURE_LOCAL_BB_CONNECTION_SECRET", originalBypass);
  });
  delete process.env.BB_CONNECTION_ENCRYPTION_SECRET;
  process.env.ALLOW_INSECURE_LOCAL_BB_CONNECTION_SECRET = "true";

  assert.equal(
    getEncryptionSecret({}),
    "local-development-secret-change-me",
  );
});

function restoreEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
