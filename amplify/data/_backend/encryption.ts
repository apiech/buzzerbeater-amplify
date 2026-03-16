import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCMTypes,
} from "node:crypto";

type EncryptedValue = {
  cipherText: string;
  iv: string;
  authTag: string;
  algorithm: CipherGCMTypes;
};

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";

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

export function getEncryptionSecret(
  env: Record<string, string | undefined>,
): string {
  const configured =
    env.BB_CONNECTION_ENCRYPTION_SECRET ??
    process.env.BB_CONNECTION_ENCRYPTION_SECRET;

  if (configured) {
    return configured;
  }

  throw new Error(
    "BB_CONNECTION_ENCRYPTION_SECRET is not configured.",
  );
}

function buildKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}
