const LEGACY_PREDICTOR_MISSING_FIELDS_MARKER =
  "Prediction request is missing required fields:";

function asError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
}

function looksLikeLegacyPredictorContractError(message: string): boolean {
  return (
    message.includes(LEGACY_PREDICTOR_MISSING_FIELDS_MARKER) &&
    message.includes("home_offStrategy") &&
    message.includes("away_offStrategy")
  );
}

export function normalizePlannerEndpointInvocationError(
  error: unknown,
  endpointName: string,
): Error {
  const resolved = asError(error);
  if (!looksLikeLegacyPredictorContractError(resolved.message)) {
    return resolved;
  }

  return new Error(
    `Predictor endpoint '${endpointName}' is still running the legacy flat matchup contract and cannot evaluate matchup matrices yet. Redeploy the predictor endpoint for this environment so it understands planner requests.`,
  );
}
