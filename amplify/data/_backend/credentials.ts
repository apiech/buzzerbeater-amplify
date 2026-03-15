import { readBbConnectionSecret } from "./bb-secrets";
import { decryptValue, getEncryptionSecret } from "./encryption";
import { getBbCredential } from "./repository";

type GraphqlEnv = Record<string, string | undefined>;

export async function resolveBbAccessKey(
  env: GraphqlEnv,
  userId: string,
): Promise<string> {
  const managedSecret = await readBbConnectionSecret(env, userId);
  if (managedSecret) {
    return managedSecret;
  }

  const credential = await getBbCredential(env, userId);
  if (!credential) {
    throw new Error("No encrypted BuzzerBeater credential is available.");
  }
  return decryptValue(credential, getEncryptionSecret(env));
}
