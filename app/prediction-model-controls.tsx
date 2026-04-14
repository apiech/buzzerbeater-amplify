"use client";

import { useRuntimeEnvironment } from "@/app/runtime-environment";
import { cn } from "@/app/ui/primitives/cn";
import { Field, Select } from "@/app/ui/primitives/field";
import {
  formatPredictionModelLabel,
  INTERNAL_PREDICTION_MODEL_OPTIONS,
  isInternalPredictionModelPickerEnabled,
  normalizePredictionModelKey,
} from "@/lib/prediction/model-selection";

type PredictionModelPickerProps = {
  hint?: string;
  label?: string;
  onChange: (value: string | null) => void;
  value: string | null | undefined;
};

type PredictionModelMetadataProps = {
  className?: string;
  requestLabel?: string;
  value: {
    modelKey?: string | null;
    modelVersion?: string | null;
  } | null;
};

export function PredictionModelPicker({
  hint = "Internal testing only. Leave this on Bundle default for normal behavior.",
  label = "Prediction model",
  onChange,
  value,
}: PredictionModelPickerProps) {
  const { environmentName } = useRuntimeEnvironment();
  if (!isInternalPredictionModelPickerEnabled(environmentName)) {
    return null;
  }

  return (
    <Field hint={hint} label={label}>
      <Select
        onChange={(event) =>
          onChange(normalizePredictionModelKey(event.currentTarget.value))
        }
        value={normalizePredictionModelKey(value) ?? ""}
      >
        {INTERNAL_PREDICTION_MODEL_OPTIONS.map((option) => (
          <option key={option.value || "bundle-default"} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function PredictionModelMetadata({
  className,
  requestLabel = "Model",
  value,
}: PredictionModelMetadataProps) {
  const { environmentName } = useRuntimeEnvironment();
  const items: Array<{ label: string; value: string }> = [];
  if (value?.modelKey) {
    items.push({
      label: requestLabel,
      value: formatPredictionModelLabel(value.modelKey),
    });
  }
  if (value?.modelVersion) {
    items.push({
      label: "Version",
      value: value.modelVersion,
    });
  }

  if (
    !isInternalPredictionModelPickerEnabled(environmentName) ||
    items.length < 1
  ) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => (
        <span
          className="inline-flex rounded-full bg-black/5 px-3 py-1.5 text-sm font-semibold text-ink-muted"
          key={`${item.label}:${item.value}`}
        >
          {item.label}: {item.value}
        </span>
      ))}
    </div>
  );
}
