import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCMTypes,
} from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

type EncryptedValue = {
  cipherText: string;
  iv: string;
  authTag: string;
  algorithm: CipherGCMTypes;
};

export type BbConnectionSecretState = {
  parameterName: string | null;
  secret: string;
  secretFingerprint: string;
};

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";
const AUTHENTICATION_FAILURE_FRAGMENT = "unable to authenticate data";
const DEFAULT_AWS_REGION = "us-east-1";
const secretStateCache = new Map<string, Promise<BbConnectionSecretState>>();

type SecretEnv = {
  AWS_DEFAULT_REGION?: string;
  AWS_REGION?: string;
  BB_CONNECTION_ENCRYPTION_SECRET?: string;
  BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME?: string;
};

const runtime = {
  createSsmClient: (region: string) => new SSMClient({ region }),
};

export const __testing = {
  buildBbConnectionSecretFingerprint,
  resetBbConnectionSecretStateCache,
  runtime,
};

export const BB_CONNECTION_SECRET_UNAVAILABLE_MESSAGE =
  "BuzzerBeater credential decryption is unavailable because this environment's encryption secret could not be loaded. Fix the environment secret configuration and try again.";

export class BbConnectionSecretUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = "BbConnectionSecretUnavailableError";
  }
}

export function encryptValue(plainText: string, secret: string): EncryptedValue {
  const iv = randomBytes(12);
  const key = buildKey(secret);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const cipherText = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);

  return {
    cipherText: cipherText.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    algorithm: ALGORITHM,
  };
}

export function decryptValue(
  encryptedValue: EncryptedValue,
  secret: string,
): string {
  const key = buildKey(secret);
  if (encryptedValue.algorithm !== ALGORITHM) {
    throw new Error(`Unsupported encryption algorithm: ${encryptedValue.algorithm}`);
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encryptedValue.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encryptedValue.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue.cipherText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedValueDecryptionFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes(AUTHENTICATION_FAILURE_FRAGMENT)
  );
}

export function isBbConnectionSecretUnavailableError(
  error: unknown,
): error is BbConnectionSecretUnavailableError {
  return error instanceof BbConnectionSecretUnavailableError;
}

export function getEncryptionSecret(
  env: {
    BB_CONNECTION_ENCRYPTION_SECRET?: string;
  },
): string {
  const configured = env.BB_CONNECTION_ENCRYPTION_SECRET;

  if (configured) {
    return configured;
  }

  throw new Error(
    "BB_CONNECTION_ENCRYPTION_SECRET is not configured.",
  );
}

export async function resolveBbConnectionSecretState(
  env: SecretEnv,
): Promise<BbConnectionSecretState> {
  const parameterName =
    env.BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME?.trim() || null;
  if (parameterName) {
    const region = resolveAwsRegion(env);
    const cacheKey = `${region}:${parameterName}`;
    const cached = secretStateCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const secretPromise = loadBbConnectionSecretFromSsm(
      parameterName,
      region,
    ).catch((error) => {
      secretStateCache.delete(cacheKey);
      throw error;
    });
    secretStateCache.set(cacheKey, secretPromise);
    return secretPromise;
  }

  const configured = env.BB_CONNECTION_ENCRYPTION_SECRET?.trim() || null;
  if (configured) {
    return {
      parameterName: null,
      secret: configured,
      secretFingerprint: buildBbConnectionSecretFingerprint(configured),
    };
  }

  throw new BbConnectionSecretUnavailableError(
    `${BB_CONNECTION_SECRET_UNAVAILABLE_MESSAGE} Missing BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME.`,
  );
}

function buildKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function buildBbConnectionSecretFingerprint(secret: string): string {
  return createHash("sha256").update(secret.trim()).digest("hex");
}

function resolveAwsRegion(env: SecretEnv): string {
  return env.AWS_REGION || env.AWS_DEFAULT_REGION || DEFAULT_AWS_REGION;
}

async function loadBbConnectionSecretFromSsm(
  parameterName: string,
  region: string,
): Promise<BbConnectionSecretState> {
  try {
    const response = await runtime
      .createSsmClient(region)
      .send(
        new GetParameterCommand({
          Name: parameterName,
          WithDecryption: true,
        }),
      );
    const secret = response.Parameter?.Value?.trim() || null;
    if (!secret) {
      throw new BbConnectionSecretUnavailableError(
        `${BB_CONNECTION_SECRET_UNAVAILABLE_MESSAGE} SSM parameter '${parameterName}' did not contain a usable value.`,
      );
    }

    return {
      parameterName,
      secret,
      secretFingerprint: buildBbConnectionSecretFingerprint(secret),
    };
  } catch (error) {
    if (isBbConnectionSecretUnavailableError(error)) {
      throw error;
    }
    throw new BbConnectionSecretUnavailableError(
      `${BB_CONNECTION_SECRET_UNAVAILABLE_MESSAGE} Unable to read SSM parameter '${parameterName}' in ${region}. ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }
}

function resetBbConnectionSecretStateCache(): void {
  secretStateCache.clear();
}
