"use client";

import { parseAsString } from "nuqs";

export const MINIMUM_STAFF_BID = 1_000;
export const STAFF_LEVEL_MIN = 1;
export const STAFF_LEVEL_MAX = 7;
export const MAX_STAFF_HORIZON_WEEKS = 260;
export const PAYBACK_LOOKAHEAD_WEEKS = 520;

export type StaffBudgetMode = "ALL_IN" | "UPGRADE_PREMIUM";
export type StaffBidDecision = "BID" | "PASS" | "INVALID";

export type StaffSlotInput = {
  role: string;
  level: number;
  weeklySalary: number;
};

export type StaffBidScenario = {
  currentStaff: StaffSlotInput;
  candidateStaff: StaffSlotInput;
  horizonWeeks: number;
  proposedBid: number;
  budgetMode: StaffBudgetMode;
  budgetCap: number;
};

export type StaffSalaryPoint = {
  week: number;
  salary: number;
  cumulativeCost: number;
};

export type StaffBidResult = {
  currentSeries: StaffSalaryPoint[];
  candidateSeries: StaffSalaryPoint[];
  growthFactors: {
    current: number;
    candidate: number;
  };
  severance: number;
  todayCashOutlay: number;
  keepCost: number;
  replaceCost: number;
  netUpgradeCost: number;
  maxRationalBid: number;
  decision: StaffBidDecision;
  proposedBid: number;
  paybackWeek: number | null;
  costPerLevel: number | null;
};

export type StaffBidFormState = {
  currentRole: string;
  currentLevel: string;
  currentWeeklySalary: string;
  candidateRole: string;
  candidateLevel: string;
  candidateWeeklySalary: string;
  horizonWeeks: string;
  proposedBid: string;
  budgetMode: StaffBudgetMode;
  budgetCap: string;
};

export type StaffBidFormField = keyof StaffBidFormState;

export type StaffBidFormErrors = Partial<Record<StaffBidFormField, string>>;

export type StaffBidParseResult = {
  errors: StaffBidFormErrors;
  missingFields: StaffBidFormField[];
  scenario: StaffBidScenario | null;
};

export type StaffBidUrlState = {
  staffCurRole: string | null;
  staffCurLevel: string | null;
  staffCurSalary: string | null;
  staffCandRole: string | null;
  staffCandLevel: string | null;
  staffCandSalary: string | null;
  staffWeeks: string | null;
  staffBid: string | null;
  staffBudgetMode: string | null;
  staffBudgetCap: string | null;
};

export const DEFAULT_STAFF_BID_FORM_STATE: StaffBidFormState = {
  budgetCap: "",
  budgetMode: "ALL_IN",
  candidateLevel: "4",
  candidateRole: "Doctor",
  candidateWeeklySalary: "",
  currentLevel: "3",
  currentRole: "Doctor",
  currentWeeklySalary: "",
  horizonWeeks: "13",
  proposedBid: String(MINIMUM_STAFF_BID),
};

export const staffRoleOptions = [
  "Doctor",
  "Trainer",
  "PR Manager",
  "Youth Trainer",
  "Psychologist",
  "Masseur",
  "Scout",
  "Other",
] as const;

export const staffBudgetModeOptions: Array<{
  label: string;
  value: StaffBudgetMode;
}> = [
  { label: "All-in cost cap", value: "ALL_IN" },
  { label: "Upgrade premium cap", value: "UPGRADE_PREMIUM" },
];

export const staffMarketUrlStateParsers = {
  staffBid: parseAsString.withOptions({ history: "replace" }),
  staffBudgetCap: parseAsString.withOptions({ history: "replace" }),
  staffBudgetMode: parseAsString.withOptions({ history: "replace" }),
  staffCandLevel: parseAsString.withOptions({ history: "replace" }),
  staffCandRole: parseAsString.withOptions({ history: "replace" }),
  staffCandSalary: parseAsString.withOptions({ history: "replace" }),
  staffCurLevel: parseAsString.withOptions({ history: "replace" }),
  staffCurRole: parseAsString.withOptions({ history: "replace" }),
  staffCurSalary: parseAsString.withOptions({ history: "replace" }),
  staffWeeks: parseAsString.withOptions({ history: "replace" }),
};

export function calculateStaffGrowthFactor(level: number): number {
  return 1.01 + 0.025 * level;
}

export function projectStaffWeeklySalary(args: {
  level: number;
  weekIndex: number;
  weeklySalary: number;
}): number {
  return Math.round(
    args.weeklySalary *
      calculateStaffGrowthFactor(args.level) ** Math.max(0, args.weekIndex),
  );
}

export function buildStaffSalarySeries(args: {
  level: number;
  weeklySalary: number;
  weeks: number;
}): StaffSalaryPoint[] {
  let cumulativeCost = 0;

  return Array.from({ length: args.weeks }, (_, index) => {
    const salary = projectStaffWeeklySalary({
      level: args.level,
      weekIndex: index,
      weeklySalary: args.weeklySalary,
    });
    cumulativeCost += salary;

    return {
      cumulativeCost,
      salary,
      week: index + 1,
    };
  });
}

export function calculateStaffBidResult(
  scenario: StaffBidScenario,
): StaffBidResult {
  const currentSeries = buildStaffSalarySeries({
    level: scenario.currentStaff.level,
    weeklySalary: scenario.currentStaff.weeklySalary,
    weeks: scenario.horizonWeeks,
  });
  const candidateSeries = buildStaffSalarySeries({
    level: scenario.candidateStaff.level,
    weeklySalary: scenario.candidateStaff.weeklySalary,
    weeks: scenario.horizonWeeks,
  });
  const keepCost = currentSeries.at(-1)?.cumulativeCost ?? 0;
  const candidateSalaryTotal = candidateSeries.at(-1)?.cumulativeCost ?? 0;
  const severance = scenario.currentStaff.weeklySalary;
  const todayCashOutlay = scenario.proposedBid + severance;
  const replaceCost = todayCashOutlay + candidateSalaryTotal;
  const netUpgradeCost = replaceCost - keepCost;
  const maxRationalBid =
    scenario.budgetMode === "ALL_IN"
      ? Math.floor(scenario.budgetCap - severance - candidateSalaryTotal)
      : Math.floor(
          scenario.budgetCap -
            severance -
            candidateSalaryTotal +
            keepCost,
        );
  const decision: StaffBidDecision =
    scenario.proposedBid < MINIMUM_STAFF_BID
      ? "INVALID"
      : maxRationalBid >= MINIMUM_STAFF_BID &&
          scenario.proposedBid <= maxRationalBid
        ? "BID"
        : "PASS";
  const paybackWeek = findStaffPaybackWeek({
    candidateStaff: scenario.candidateStaff,
    currentStaff: scenario.currentStaff,
    upfrontCost: todayCashOutlay,
  });
  const levelGain = scenario.candidateStaff.level - scenario.currentStaff.level;
  const costPerLevel =
    levelGain > 0 ? Math.round(netUpgradeCost / levelGain) : null;

  return {
    candidateSeries,
    costPerLevel,
    currentSeries,
    decision,
    growthFactors: {
      candidate: calculateStaffGrowthFactor(scenario.candidateStaff.level),
      current: calculateStaffGrowthFactor(scenario.currentStaff.level),
    },
    keepCost,
    maxRationalBid,
    netUpgradeCost,
    paybackWeek,
    proposedBid: scenario.proposedBid,
    replaceCost,
    severance,
    todayCashOutlay,
  };
}

export function parseStaffBidFormState(
  formState: StaffBidFormState,
): StaffBidParseResult {
  const errors: StaffBidFormErrors = {};
  const missingFields: StaffBidFormField[] = [];

  const currentLevel = parseWholeNumberField({
    errors,
    field: "currentLevel",
    max: STAFF_LEVEL_MAX,
    min: STAFF_LEVEL_MIN,
    missingFields,
    value: formState.currentLevel,
  });
  const candidateLevel = parseWholeNumberField({
    errors,
    field: "candidateLevel",
    max: STAFF_LEVEL_MAX,
    min: STAFF_LEVEL_MIN,
    missingFields,
    value: formState.candidateLevel,
  });
  const currentWeeklySalary = parseWholeNumberField({
    errors,
    field: "currentWeeklySalary",
    max: Number.MAX_SAFE_INTEGER,
    min: 1,
    missingFields,
    value: formState.currentWeeklySalary,
  });
  const candidateWeeklySalary = parseWholeNumberField({
    errors,
    field: "candidateWeeklySalary",
    max: Number.MAX_SAFE_INTEGER,
    min: 1,
    missingFields,
    value: formState.candidateWeeklySalary,
  });
  const horizonWeeks = parseWholeNumberField({
    errors,
    field: "horizonWeeks",
    max: MAX_STAFF_HORIZON_WEEKS,
    min: 1,
    missingFields,
    value: formState.horizonWeeks,
  });
  const proposedBid = parseWholeNumberField({
    errors,
    field: "proposedBid",
    max: Number.MAX_SAFE_INTEGER,
    min: 0,
    missingFields,
    value: formState.proposedBid,
  });
  const budgetCap = parseWholeNumberField({
    errors,
    field: "budgetCap",
    max: Number.MAX_SAFE_INTEGER,
    min: 1,
    missingFields,
    value: formState.budgetCap,
  });

  if (
    proposedBid !== null &&
    proposedBid < MINIMUM_STAFF_BID &&
    !errors.proposedBid
  ) {
    errors.proposedBid = `Bids below ${MINIMUM_STAFF_BID.toLocaleString("en-US")} are invalid.`;
  }

  const hasBlockingError = [
    currentLevel,
    candidateLevel,
    currentWeeklySalary,
    candidateWeeklySalary,
    horizonWeeks,
    proposedBid,
    budgetCap,
  ].some((value) => value === null);

  if (hasBlockingError) {
    return {
      errors,
      missingFields,
      scenario: null,
    };
  }

  return {
    errors,
    missingFields,
    scenario: {
      budgetCap: budgetCap as number,
      budgetMode: normalizeStaffBudgetMode(formState.budgetMode),
      candidateStaff: {
        level: candidateLevel as number,
        role: normalizeStaffRole(formState.candidateRole),
        weeklySalary: candidateWeeklySalary as number,
      },
      currentStaff: {
        level: currentLevel as number,
        role: normalizeStaffRole(formState.currentRole),
        weeklySalary: currentWeeklySalary as number,
      },
      horizonWeeks: horizonWeeks as number,
      proposedBid: proposedBid as number,
    },
  };
}

export function readStaffBidFormState(
  urlState: Partial<StaffBidUrlState>,
): StaffBidFormState {
  return {
    budgetCap: normalizeOptionalString(urlState.staffBudgetCap),
    budgetMode: normalizeStaffBudgetMode(urlState.staffBudgetMode),
    candidateLevel:
      normalizeOptionalString(urlState.staffCandLevel) ||
      DEFAULT_STAFF_BID_FORM_STATE.candidateLevel,
    candidateRole: normalizeStaffRole(urlState.staffCandRole),
    candidateWeeklySalary: normalizeOptionalString(urlState.staffCandSalary),
    currentLevel:
      normalizeOptionalString(urlState.staffCurLevel) ||
      DEFAULT_STAFF_BID_FORM_STATE.currentLevel,
    currentRole: normalizeStaffRole(urlState.staffCurRole),
    currentWeeklySalary: normalizeOptionalString(urlState.staffCurSalary),
    horizonWeeks:
      normalizeOptionalString(urlState.staffWeeks) ||
      DEFAULT_STAFF_BID_FORM_STATE.horizonWeeks,
    proposedBid:
      normalizeOptionalString(urlState.staffBid) ||
      DEFAULT_STAFF_BID_FORM_STATE.proposedBid,
  };
}

export function buildStaffBidUrlState(
  formState: StaffBidFormState,
): StaffBidUrlState {
  return {
    staffBid: normalizeUrlFieldValue(
      formState.proposedBid,
      DEFAULT_STAFF_BID_FORM_STATE.proposedBid,
    ),
    staffBudgetCap: normalizeUrlFieldValue(formState.budgetCap),
    staffBudgetMode: normalizeUrlFieldValue(
      formState.budgetMode,
      DEFAULT_STAFF_BID_FORM_STATE.budgetMode,
    ),
    staffCandLevel: normalizeUrlFieldValue(
      formState.candidateLevel,
      DEFAULT_STAFF_BID_FORM_STATE.candidateLevel,
    ),
    staffCandRole: normalizeUrlFieldValue(
      formState.candidateRole,
      DEFAULT_STAFF_BID_FORM_STATE.candidateRole,
    ),
    staffCandSalary: normalizeUrlFieldValue(formState.candidateWeeklySalary),
    staffCurLevel: normalizeUrlFieldValue(
      formState.currentLevel,
      DEFAULT_STAFF_BID_FORM_STATE.currentLevel,
    ),
    staffCurRole: normalizeUrlFieldValue(
      formState.currentRole,
      DEFAULT_STAFF_BID_FORM_STATE.currentRole,
    ),
    staffCurSalary: normalizeUrlFieldValue(formState.currentWeeklySalary),
    staffWeeks: normalizeUrlFieldValue(
      formState.horizonWeeks,
      DEFAULT_STAFF_BID_FORM_STATE.horizonWeeks,
    ),
  };
}

export function buildStaffBidSearchParams(
  formState: StaffBidFormState,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(buildStaffBidUrlState(formState))) {
    if (value) {
      params.set(key, value);
    }
  }

  return params;
}

export function readStaffBidFormStateFromSearchParams(
  params: URLSearchParams,
): StaffBidFormState {
  return readStaffBidFormState({
    staffBid: params.get("staffBid"),
    staffBudgetCap: params.get("staffBudgetCap"),
    staffBudgetMode: params.get("staffBudgetMode"),
    staffCandLevel: params.get("staffCandLevel"),
    staffCandRole: params.get("staffCandRole"),
    staffCandSalary: params.get("staffCandSalary"),
    staffCurLevel: params.get("staffCurLevel"),
    staffCurRole: params.get("staffCurRole"),
    staffCurSalary: params.get("staffCurSalary"),
    staffWeeks: params.get("staffWeeks"),
  });
}

export function buildMissingFieldMessage(
  missingFields: StaffBidFormField[],
): string | null {
  const labels = missingFields.flatMap((field) => {
      switch (field) {
        case "budgetCap":
          return ["budget cap"];
        case "candidateWeeklySalary":
          return ["candidate weekly salary"];
        case "currentWeeklySalary":
          return ["current weekly salary"];
        case "proposedBid":
          return ["proposed bid"];
        case "horizonWeeks":
          return ["planning horizon"];
        case "candidateLevel":
          return ["candidate level"];
        case "currentLevel":
          return ["current level"];
        case "budgetMode":
        case "candidateRole":
        case "currentRole":
          return [];
      }
    });

  if (!labels.length) {
    return null;
  }

  return `Enter ${joinHumanList(labels)} to evaluate this staff replacement.`;
}

function findStaffPaybackWeek(args: {
  candidateStaff: StaffSlotInput;
  currentStaff: StaffSlotInput;
  upfrontCost: number;
}): number | null {
  let keepCost = 0;
  let replaceCost = args.upfrontCost;

  for (let weekIndex = 0; weekIndex < PAYBACK_LOOKAHEAD_WEEKS; weekIndex += 1) {
    keepCost += projectStaffWeeklySalary({
      level: args.currentStaff.level,
      weekIndex,
      weeklySalary: args.currentStaff.weeklySalary,
    });
    replaceCost += projectStaffWeeklySalary({
      level: args.candidateStaff.level,
      weekIndex,
      weeklySalary: args.candidateStaff.weeklySalary,
    });

    if (replaceCost <= keepCost) {
      return weekIndex + 1;
    }
  }

  return null;
}

function parseWholeNumberField(args: {
  errors: StaffBidFormErrors;
  field: StaffBidFormField;
  max: number;
  min: number;
  missingFields: StaffBidFormField[];
  value: string;
}): number | null {
  const rawValue = normalizeOptionalString(args.value);
  if (!rawValue) {
    args.missingFields.push(args.field);
    return null;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    args.errors[args.field] = `Enter a whole number from ${args.min} to ${args.max.toLocaleString("en-US")}.`;
    return null;
  }

  if (numericValue < args.min || numericValue > args.max) {
    args.errors[args.field] = `Enter a whole number from ${args.min} to ${args.max.toLocaleString("en-US")}.`;
    return null;
  }

  return numericValue;
}

function normalizeStaffBudgetMode(
  value: string | null | undefined,
): StaffBudgetMode {
  return value === "UPGRADE_PREMIUM" ? "UPGRADE_PREMIUM" : "ALL_IN";
}

function normalizeStaffRole(value: string | null | undefined): string {
  const normalized = normalizeOptionalString(value);
  return normalized || DEFAULT_STAFF_BID_FORM_STATE.currentRole;
}

function normalizeOptionalString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeUrlFieldValue(
  value: string,
  defaultValue?: string,
): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }
  if (defaultValue && normalized === defaultValue) {
    return null;
  }
  return normalized;
}

function joinHumanList(values: string[]): string {
  if (values.length === 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
