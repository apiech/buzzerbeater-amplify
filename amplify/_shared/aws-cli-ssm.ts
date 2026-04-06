const MAX_PARAMETER_NAMES_PER_GET_PARAMETERS_CALL = 10;

export type AwsCliParameterExecutor = (args: string[]) => unknown;

export type AwsCliGetParametersResponse = {
  InvalidParameters?: string[];
  Parameters?: Array<{ Name?: string; Value?: string }>;
};

export function getParametersByName({
  execAwsJson,
  names,
  region,
  withDecryption = true,
}: {
  execAwsJson: AwsCliParameterExecutor;
  names: string[];
  region: string;
  withDecryption?: boolean;
}): AwsCliGetParametersResponse {
  const combined: AwsCliGetParametersResponse = {
    InvalidParameters: [],
    Parameters: [],
  };

  for (const batch of chunkValues(names, MAX_PARAMETER_NAMES_PER_GET_PARAMETERS_CALL)) {
    const args = [
      "ssm",
      "get-parameters",
      "--region",
      region,
      "--output",
      "json",
    ];
    if (withDecryption) {
      args.push("--with-decryption");
    }
    args.push("--names", ...batch);

    const response = execAwsJson(args) as AwsCliGetParametersResponse;
    combined.InvalidParameters?.push(...(response.InvalidParameters ?? []));
    combined.Parameters?.push(...(response.Parameters ?? []));
  }

  return combined;
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}
