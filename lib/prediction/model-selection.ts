export const INTERNAL_PREDICTION_MODEL_OPTIONS = [
  {
    description: "Use the release default model.",
    label: "Bundle default",
    value: "",
  },
  {
    description: "Force the current XGBoost predictor.",
    label: "XGBoost",
    value: "xgb",
  },
  {
    description: "Force the current CatBoost predictor.",
    label: "CatBoost",
    value: "catboost",
  },
  {
    description: "Force the current decomposition predictor.",
    label: "Decomposition",
    value: "decomposition",
  },
] as const;

export function normalizePredictionModelKey(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function formatPredictionModelLabel(
  value: string | null | undefined,
): string {
  const normalized = normalizePredictionModelKey(value);
  if (!normalized) {
    return "Bundle default";
  }

  const matchedOption = INTERNAL_PREDICTION_MODEL_OPTIONS.find(
    (option) => option.value === normalized,
  );
  return matchedOption?.label ?? normalized;
}

export function isInternalPredictionModelPickerEnabled(
  environmentName: string | null | undefined,
): boolean {
  return environmentName?.trim().toLowerCase() !== "prod";
}
