import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as encryptionTesting,
  BB_CONNECTION_SECRET_UNAVAILABLE_MESSAGE,
  BbConnectionSecretUnavailableError,
  getEncryptionSecret,
  resolveBbConnectionSecretState,
} from "../amplify/data/_backend/encryption";

test("getEncryptionSecret returns the configured secret when present", () => {
  assert.equal(
    getEncryptionSecret({ BB_CONNECTION_ENCRYPTION_SECRET: "configured-secret" }),
    "configured-secret",
  );
});

test("getEncryptionSecret throws when no secret is configured", (t) => {
  const originalSecret = process.env.BB_CONNECTION_ENCRYPTION_SECRET;
  t.after(() => {
    restoreEnvValue("BB_CONNECTION_ENCRYPTION_SECRET", originalSecret);
  });
  delete process.env.BB_CONNECTION_ENCRYPTION_SECRET;

  assert.throws(
    () => getEncryptionSecret({}),
    /BB_CONNECTION_ENCRYPTION_SECRET is not configured\./,
  );
});

test("resolveBbConnectionSecretState reads and caches the canonical SSM secret", async (t) => {
  const originalCreateSsmClient = encryptionTesting.runtime.createSsmClient;
  const calls: Array<{ command: { input: { Name?: string; WithDecryption?: boolean } }; region: string }> = [];

  t.after(() => {
    encryptionTesting.runtime.createSsmClient = originalCreateSsmClient;
    encryptionTesting.resetBbConnectionSecretStateCache();
  });

  encryptionTesting.resetBbConnectionSecretStateCache();
  encryptionTesting.runtime.createSsmClient = (region) => ({
    send: async (command: { input: { Name?: string; WithDecryption?: boolean } }) => {
      calls.push({ command, region });
      return {
        Parameter: {
          Value: "shared-secret",
        },
      };
    },
  }) as any;

  const env = {
    AWS_REGION: "us-east-1",
    BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME:
      "/buzzerbeater/ml-data-infra/dev/bb-connection-encryption-secret",
  };

  const first = await resolveBbConnectionSecretState(env);
  const second = await resolveBbConnectionSecretState(env);

  assert.equal(first.secret, "shared-secret");
  assert.equal(first.parameterName, env.BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME);
  assert.equal(first.secretFingerprint.length, 64);
  assert.deepStrictEqual(second, first);
  assert.equal(calls.length, 1);
  const firstCall = calls[0];
  assert.ok(firstCall);
  assert.equal(firstCall.region, "us-east-1");
  assert.deepStrictEqual(firstCall.command.input, {
    Name: "/buzzerbeater/ml-data-infra/dev/bb-connection-encryption-secret",
    WithDecryption: true,
  });
});

test("resolveBbConnectionSecretState surfaces SSM read failures as operator-facing errors", async (t) => {
  const originalCreateSsmClient = encryptionTesting.runtime.createSsmClient;

  t.after(() => {
    encryptionTesting.runtime.createSsmClient = originalCreateSsmClient;
    encryptionTesting.resetBbConnectionSecretStateCache();
  });

  encryptionTesting.resetBbConnectionSecretStateCache();
  encryptionTesting.runtime.createSsmClient = () => ({
    send: async () => {
      throw new Error("AccessDenied: denied");
    },
  }) as any;

  await assert.rejects(
    () =>
      resolveBbConnectionSecretState({
        AWS_REGION: "us-east-1",
        BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME:
          "/buzzerbeater/ml-data-infra/dev/bb-connection-encryption-secret",
      }),
    (error: unknown) => {
      assert.ok(error instanceof BbConnectionSecretUnavailableError);
      assert.match(error.message, new RegExp(BB_CONNECTION_SECRET_UNAVAILABLE_MESSAGE));
      assert.match(error.message, /Unable to read SSM parameter/);
      return true;
    },
  );
});

function restoreEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
