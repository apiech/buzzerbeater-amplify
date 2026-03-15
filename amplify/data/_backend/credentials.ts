import { decryptValue, getEncryptionSecret } from "./encryption";
import { getBbCredential } from "./repository";

type GraphqlEnv = Record<string, string | undefined>;

const runtime = {
  decryptValue,
  getBbCredential,
};

export const __testing = {
  runtime,
};

export async function resolveBbAccessKey(
  env: GraphqlEnv,
  userId: string,
): Promise<string> {
  const credential = await runtime.getBbCredential(env, userId);
  if (!credential) {
    throw new Error("No encrypted BuzzerBeater credential is available.");
  }
  return runtime.decryptValue(credential, getEncryptionSecret(env));
}
