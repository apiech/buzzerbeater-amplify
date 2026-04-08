import {
  decryptValue,
  getEncryptionSecret,
  isEncryptedValueDecryptionFailure,
} from "./encryption";
import { getBbCredential } from "./repository";

type GraphqlEnv = Record<string, string | undefined>;
export const BB_CREDENTIAL_RECONNECT_REQUIRED_MESSAGE =
  "Reconnect BuzzerBeater: the saved credential for this environment can no longer be decrypted.";

export class BbCredentialReconnectRequiredError extends Error {
  constructor(cause?: unknown) {
    super(BB_CREDENTIAL_RECONNECT_REQUIRED_MESSAGE, cause ? { cause } : undefined);
    this.name = "BbCredentialReconnectRequiredError";
  }
}

const runtime = {
  decryptValue,
  getBbCredential,
};

export const __testing = {
  runtime,
};

export function isBbCredentialReconnectRequiredError(
  error: unknown,
): error is BbCredentialReconnectRequiredError {
  return error instanceof BbCredentialReconnectRequiredError;
}

export async function assertBbCredentialReadable(
  env: GraphqlEnv,
  userId: string,
): Promise<void> {
  await resolveBbAccessKey(env, userId);
}

export async function resolveBbAccessKey(
  env: GraphqlEnv,
  userId: string,
): Promise<string> {
  const credential = await runtime.getBbCredential(env, userId);
  if (!credential) {
    throw new Error("No encrypted BuzzerBeater credential is available.");
  }
  try {
    return runtime.decryptValue(credential, getEncryptionSecret(env));
  } catch (error) {
    throw normalizeBbCredentialReadError(error);
  }
}

function normalizeBbCredentialReadError(error: unknown): Error {
  if (isBbCredentialReconnectRequiredError(error)) {
    return error;
  }
  if (isEncryptedValueDecryptionFailure(error)) {
    return new BbCredentialReconnectRequiredError(error);
  }
  return error instanceof Error ? error : new Error(String(error));
}
