import {
  decryptValue,
  isBbConnectionSecretUnavailableError,
  isEncryptedValueDecryptionFailure,
  resolveBbConnectionSecretState,
} from "./encryption";
import { getBbCredential, upsertBbCredential } from "./repository";

type GraphqlEnv = Record<string, string | undefined>;
export const BB_CREDENTIAL_RECONNECT_REQUIRED_MESSAGE =
  "Reconnect BuzzerBeater: the saved credential for this environment can no longer be decrypted.";
export const BB_CREDENTIAL_SECRET_MISMATCH_MESSAGE =
  "BuzzerBeater credential secret mismatch: the saved credential was encrypted with a different environment secret. If this environment secret was rotated intentionally, reconnect BuzzerBeater in this environment. Otherwise, fix the environment secret configuration and try again.";
export const BB_CREDENTIAL_SECRET_UNAVAILABLE_MESSAGE =
  "BuzzerBeater credential decryption is unavailable because this environment's encryption secret could not be loaded. Fix the environment secret configuration and try again.";
export const BB_CREDENTIAL_RECONNECT_REQUIRED_ERROR_CODE =
  "reconnect_required";
export const BB_CREDENTIAL_SECRET_MISMATCH_ERROR_CODE = "secret_mismatch";
export const BB_CREDENTIAL_SECRET_UNAVAILABLE_ERROR_CODE =
  "secret_unavailable";

export class BbCredentialReconnectRequiredError extends Error {
  constructor(cause?: unknown) {
    super(BB_CREDENTIAL_RECONNECT_REQUIRED_MESSAGE, cause ? { cause } : undefined);
    this.name = "BbCredentialReconnectRequiredError";
  }
}

export class BbCredentialSecretMismatchError extends Error {
  constructor(cause?: unknown) {
    super(BB_CREDENTIAL_SECRET_MISMATCH_MESSAGE, cause ? { cause } : undefined);
    this.name = "BbCredentialSecretMismatchError";
  }
}

export class BbCredentialSecretUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      BB_CREDENTIAL_SECRET_UNAVAILABLE_MESSAGE,
      cause ? { cause } : undefined,
    );
    this.name = "BbCredentialSecretUnavailableError";
  }
}

const runtime = {
  decryptValue,
  getBbCredential,
  resolveBbConnectionSecretState,
  upsertBbCredential,
};

export const __testing = {
  runtime,
};

export function isBbCredentialReconnectRequiredError(
  error: unknown,
): error is BbCredentialReconnectRequiredError {
  return error instanceof BbCredentialReconnectRequiredError;
}

export function isBbCredentialSecretMismatchError(
  error: unknown,
): error is BbCredentialSecretMismatchError {
  return error instanceof BbCredentialSecretMismatchError;
}

export function isBbCredentialSecretUnavailableError(
  error: unknown,
): error is BbCredentialSecretUnavailableError {
  return error instanceof BbCredentialSecretUnavailableError;
}

export function resolveBbCredentialErrorCode(error: unknown): string | null {
  if (isBbCredentialSecretMismatchError(error)) {
    return BB_CREDENTIAL_SECRET_MISMATCH_ERROR_CODE;
  }
  if (isBbCredentialSecretUnavailableError(error)) {
    return BB_CREDENTIAL_SECRET_UNAVAILABLE_ERROR_CODE;
  }
  if (isBbCredentialReconnectRequiredError(error)) {
    return BB_CREDENTIAL_RECONNECT_REQUIRED_ERROR_CODE;
  }
  return null;
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
    const secretState = await runtime.resolveBbConnectionSecretState(env);
    if (
      credential.secretFingerprint?.trim() &&
      credential.secretFingerprint.trim() !== secretState.secretFingerprint
    ) {
      throw new BbCredentialSecretMismatchError();
    }
    const accessKey = runtime.decryptValue(credential, secretState.secret);
    if (!credential.secretFingerprint?.trim()) {
      await runtime.upsertBbCredential(env, {
        ...credential,
        secretFingerprint: secretState.secretFingerprint,
      });
    }
    return accessKey;
  } catch (error) {
    throw normalizeBbCredentialReadError(error);
  }
}

function normalizeBbCredentialReadError(error: unknown): Error {
  if (isBbCredentialReconnectRequiredError(error)) {
    return error;
  }
  if (isBbCredentialSecretMismatchError(error)) {
    return error;
  }
  if (isBbCredentialSecretUnavailableError(error)) {
    return error;
  }
  if (isBbConnectionSecretUnavailableError(error)) {
    return new BbCredentialSecretUnavailableError(error);
  }
  if (isEncryptedValueDecryptionFailure(error)) {
    return new BbCredentialReconnectRequiredError(error);
  }
  return error instanceof Error ? error : new Error(String(error));
}
