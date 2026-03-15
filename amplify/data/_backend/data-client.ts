import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";

import type { Schema } from "../resource";

type DataClientEnv = Parameters<typeof getAmplifyDataClientConfig>[0];

export type AmplifyDataFunctionEnv = DataClientEnv &
  Record<string, string | undefined>;

type GeneratedDataClient = ReturnType<typeof generateClient<Schema>>;

const clientCache = new Map<string, Promise<GeneratedDataClient>>();

export async function getDataClient(
  env: AmplifyDataFunctionEnv,
): Promise<GeneratedDataClient> {
  const cacheKey = `${env.AWS_REGION}:${env.AMPLIFY_DATA_DEFAULT_NAME}`;
  const cachedClient = clientCache.get(cacheKey);
  if (cachedClient) {
    return cachedClient;
  }

  const clientPromise = configureDataClient(env).catch((error) => {
    clientCache.delete(cacheKey);
    throw error;
  });

  clientCache.set(cacheKey, clientPromise);
  return clientPromise;
}

async function configureDataClient(
  env: AmplifyDataFunctionEnv,
): Promise<GeneratedDataClient> {
  const { resourceConfig, libraryOptions } =
    await getAmplifyDataClientConfig(env);

  Amplify.configure(resourceConfig, libraryOptions);

  return generateClient<Schema>();
}
