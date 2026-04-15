import {
  InvokeEndpointCommand,
  SageMakerRuntimeClient,
} from "@aws-sdk/client-sagemaker-runtime";

let predictionRuntimeClient: SageMakerRuntimeClient | null = null;

export function getPredictionRuntimeClient(): SageMakerRuntimeClient {
  if (!predictionRuntimeClient) {
    predictionRuntimeClient = new SageMakerRuntimeClient({});
  }

  return predictionRuntimeClient;
}

export async function invokePredictionRuntimeEndpoint(args: {
  endpointName: string;
  payload: unknown;
}): Promise<unknown> {
  const response = await getPredictionRuntimeClient().send(
    new InvokeEndpointCommand({
      EndpointName: args.endpointName,
      ContentType: "application/json",
      Body: Buffer.from(JSON.stringify(args.payload)),
    }),
  );

  const rawBody = response.Body?.transformToString
    ? await Promise.resolve(response.Body.transformToString())
    : Buffer.from(response.Body ?? []).toString("utf-8");

  return rawBody ? JSON.parse(rawBody) : null;
}
