import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as trackedTeamsTesting,
  deactivateActiveTrackedTeamsForUser,
} from "../amplify/data/_backend/active-tracked-teams";
import {
  BB_CREDENTIAL_SECRET_MISMATCH_ERROR_CODE,
  __testing as credentialTesting,
  resolveBbCredentialErrorCode,
  resolveBbAccessKey,
} from "../amplify/data/_backend/credentials";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

test("resolveBbAccessKey decrypts the stored BbCredential only", async (t) => {
  const originalGetBbCredential = credentialTesting.runtime.getBbCredential;
  const originalDecryptValue = credentialTesting.runtime.decryptValue;
  const originalResolveBbConnectionSecretState =
    credentialTesting.runtime.resolveBbConnectionSecretState;
  const originalUpsertBbCredential = credentialTesting.runtime.upsertBbCredential;
  const fingerprintWrites: Array<Record<string, unknown>> = [];

  t.after(() => {
    credentialTesting.runtime.getBbCredential = originalGetBbCredential;
    credentialTesting.runtime.decryptValue = originalDecryptValue;
    credentialTesting.runtime.resolveBbConnectionSecretState =
      originalResolveBbConnectionSecretState;
    credentialTesting.runtime.upsertBbCredential = originalUpsertBbCredential;
  });

  credentialTesting.runtime.getBbCredential = async () => ({
    userId: "user-1",
    cipherText: "cipher",
    iv: "iv",
    authTag: "auth",
    algorithm: "aes-256-gcm",
  });

  let decryptedSecret: string | null = null;
  credentialTesting.runtime.decryptValue = (_value, secret) => {
    decryptedSecret = secret;
    return "access-key";
  };
  credentialTesting.runtime.resolveBbConnectionSecretState = async () => ({
    parameterName:
      "/buzzerbeater/ml-data-infra/dev/bb-connection-encryption-secret",
    secret: "shared-secret",
    secretFingerprint: "fingerprint-1",
  });
  credentialTesting.runtime.upsertBbCredential = async (_env, record) => {
    fingerprintWrites.push(record as Record<string, unknown>);
  };

  const accessKey = await resolveBbAccessKey(
    {
      BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME:
        "/buzzerbeater/ml-data-infra/dev/bb-connection-encryption-secret",
    },
    "user-1",
  );

  assert.equal(accessKey, "access-key");
  assert.equal(decryptedSecret, "shared-secret");
  assert.deepStrictEqual(fingerprintWrites, [
    {
      algorithm: "aes-256-gcm",
      authTag: "auth",
      cipherText: "cipher",
      iv: "iv",
      secretFingerprint: "fingerprint-1",
      userId: "user-1",
    },
  ]);
});

test("resolveBbAccessKey reports secret mismatch when the stored fingerprint drifts", async (t) => {
  const originalGetBbCredential = credentialTesting.runtime.getBbCredential;
  const originalResolveBbConnectionSecretState =
    credentialTesting.runtime.resolveBbConnectionSecretState;
  const originalUpsertBbCredential = credentialTesting.runtime.upsertBbCredential;

  t.after(() => {
    credentialTesting.runtime.getBbCredential = originalGetBbCredential;
    credentialTesting.runtime.resolveBbConnectionSecretState =
      originalResolveBbConnectionSecretState;
    credentialTesting.runtime.upsertBbCredential = originalUpsertBbCredential;
  });

  credentialTesting.runtime.getBbCredential = async () => ({
    userId: "user-1",
    cipherText: "cipher",
    iv: "iv",
    authTag: "auth",
    algorithm: "aes-256-gcm",
    secretFingerprint: "fingerprint-old",
  });
  credentialTesting.runtime.resolveBbConnectionSecretState = async () => ({
    parameterName:
      "/buzzerbeater/ml-data-infra/dev/bb-connection-encryption-secret",
    secret: "shared-secret",
    secretFingerprint: "fingerprint-new",
  });
  credentialTesting.runtime.upsertBbCredential = async () => {
    throw new Error("upsertBbCredential should not be called");
  };

  let error: unknown;
  try {
    await resolveBbAccessKey(
      {
        BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME:
          "/buzzerbeater/ml-data-infra/dev/bb-connection-encryption-secret",
      },
      "user-1",
    );
    assert.fail("resolveBbAccessKey should reject when the fingerprint drifts");
  } catch (caughtError) {
    error = caughtError;
  }

  assert.equal(
    resolveBbCredentialErrorCode(error),
    BB_CREDENTIAL_SECRET_MISMATCH_ERROR_CODE,
  );
  assert.match(String((error as Error).message), /secret mismatch/i);
});

test("deactivateActiveTrackedTeamsForUser clears projected credentials while leaving rows in place", async (t) => {
  const originalDocumentClient = trackedTeamsTesting.runtime.documentClient;
  const putItems: Array<Record<string, unknown>> = [];

  t.after(() => {
    trackedTeamsTesting.runtime.documentClient = originalDocumentClient;
  });

  trackedTeamsTesting.runtime.documentClient = {
    send: async (command: QueryCommand | PutCommand) => {
      if (command instanceof QueryCommand) {
        return {
          Items: [
            {
              userId: "user-1",
              teamId: "163730",
              bbLoginName: "coach",
              credentialCipherText: "cipher",
              credentialIv: "iv",
              credentialAuthTag: "auth",
              credentialAlgorithm: "aes-256-gcm",
              active: true,
              isPrimary: true,
              updatedAt: "2026-03-15T00:00:00.000Z",
            },
          ],
        };
      }

      if (command instanceof PutCommand) {
        putItems.push(command.input.Item as Record<string, unknown>);
        return {};
      }

      throw new Error("Unexpected command");
    },
  } as any;

  await deactivateActiveTrackedTeamsForUser(
    { ACTIVE_TRACKED_TEAMS_TABLE_NAME: "ActiveTrackedTeams" },
    "user-1",
  );

  assert.equal(putItems.length, 1);
  const firstPutItem = putItems[0];
  assert.ok(firstPutItem);
  assert.equal(firstPutItem.active, false);
  assert.equal(firstPutItem.credentialCipherText, null);
  assert.equal(firstPutItem.credentialIv, null);
  assert.equal(firstPutItem.credentialAuthTag, null);
  assert.equal(firstPutItem.credentialAlgorithm, null);
  assert.equal(firstPutItem.credentialSecretFingerprint, null);
});
