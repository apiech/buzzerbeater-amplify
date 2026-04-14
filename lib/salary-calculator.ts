import type { BBApiOwnedRosterPlayer } from "./bbapi";

export const SALARY_POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"] as const;
export const SALARY_SKILL_KEYS = [
  "jumpShot",
  "jumpRange",
  "outsideDefense",
  "handling",
  "driving",
  "passing",
  "insideScoring",
  "insideDefense",
  "rebounding",
  "shotBlocking",
] as const;

export const CHROMEBB_MODEL_SOURCE = "chromebb";
export const CHROMEBB_MODEL_SOURCE_CONFIDENCE = "direct_public_code";
export const DEFAULT_SALARY_CALIBRATION_MODE = "IDENTITY";
export const DEFAULT_SALARY_CORRECTION_FACTOR = 1;

export type SalaryPosition = (typeof SALARY_POSITION_ORDER)[number];
export type SalarySkillKey = (typeof SALARY_SKILL_KEYS)[number];
export type SalarySkills = Record<SalarySkillKey, number>;
export type SalaryByPosition = Record<SalaryPosition, number>;

type PositionMultiplierMap = Record<SalaryPosition, SalarySkills>;

const CHROMEBB_JOSEF_KA_BASE = 300.0;
const CHROMEBB_JOSEF_KA_CORRECTION_FACTOR = 0.86;
const CHROMEBB_JOSEF_KA_DEFLATION_MODELS = [
  { d: 0.0180707, k: 0.9885151 },
  { d: 0.1283662, k: 2.3867857 },
] as const;
const CHROMEBB_JOSEF_KA_MULTIPLIERS: PositionMultiplierMap = {
  PG: {
    driving: 1.04,
    handling: 1.08,
    insideDefense: 1,
    insideScoring: 1,
    jumpRange: 1.045,
    jumpShot: 1.025,
    outsideDefense: 1.08,
    passing: 1.155,
    rebounding: 1.035,
    shotBlocking: 1,
  },
  SG: {
    driving: 1,
    handling: 1,
    insideDefense: 1,
    insideScoring: 1,
    jumpRange: 1.15,
    jumpShot: 1.125,
    outsideDefense: 1.13,
    passing: 1,
    rebounding: 1.065,
    shotBlocking: 1,
  },
  SF: {
    driving: 1,
    handling: 1,
    insideDefense: 1.06,
    insideScoring: 1,
    jumpRange: 1.085,
    jumpShot: 1.18,
    outsideDefense: 1.065,
    passing: 1,
    rebounding: 1.09,
    shotBlocking: 1.005,
  },
  PF: {
    driving: 1,
    handling: 1,
    insideDefense: 1.115,
    insideScoring: 1.115,
    jumpRange: 1,
    jumpShot: 1.08,
    outsideDefense: 1,
    passing: 1,
    rebounding: 1.115,
    shotBlocking: 1.06,
  },
  C: {
    driving: 1,
    handling: 1,
    insideDefense: 1.135,
    insideScoring: 1.138,
    jumpRange: 1,
    jumpShot: 1,
    outsideDefense: 1,
    passing: 1,
    rebounding: 1.13,
    shotBlocking: 1.065,
  },
};

const CHROMEBB_BB_USA_BASE = 245.0;
const CHROMEBB_BB_USA_ADJUSTMENT_PARAMS = {
  salA: 1.000404,
  salB: 0.00117,
  salC: 9.383502,
  salD: 4.798096,
  salE: -0.000113,
} as const;
const CHROMEBB_BB_USA_MULTIPLIERS: PositionMultiplierMap = {
  PG: {
    driving: 1.036,
    handling: 1.0725,
    insideDefense: 1.001,
    insideScoring: 1.0005,
    jumpRange: 1.046,
    jumpShot: 1.0319,
    outsideDefense: 1.0728,
    passing: 1.1515,
    rebounding: 1.0361,
    shotBlocking: 0.9996,
  },
  SG: {
    driving: 1.0012,
    handling: 1.0012,
    insideDefense: 1.001,
    insideScoring: 0.9997,
    jumpRange: 1.1466,
    jumpShot: 1.116,
    outsideDefense: 1.1268,
    passing: 1.0019,
    rebounding: 1.0623,
    shotBlocking: 0.9993,
  },
  SF: {
    driving: 0.9999,
    handling: 1.0027,
    insideDefense: 1.0581,
    insideScoring: 1.0007,
    jumpRange: 1.0839,
    jumpShot: 1.1701,
    outsideDefense: 1.0614,
    passing: 1.0007,
    rebounding: 1.0896,
    shotBlocking: 1.0016,
  },
  PF: {
    driving: 1.0019,
    handling: 1.0014,
    insideDefense: 1.1101,
    insideScoring: 1.1123,
    jumpRange: 1.0013,
    jumpShot: 1.0779,
    outsideDefense: 1.0002,
    passing: 1.0003,
    rebounding: 1.1099,
    shotBlocking: 1.0528,
  },
  C: {
    driving: 1.0004,
    handling: 0.9996,
    insideDefense: 1.1283,
    insideScoring: 1.1299,
    jumpRange: 1.0009,
    jumpShot: 1.0011,
    outsideDefense: 1.0001,
    passing: 1.0007,
    rebounding: 1.1281,
    shotBlocking: 1.0619,
  },
};

export type SalaryCalibrationConfig = {
  correctionFactor: number;
  mode: string;
};

export type SalaryEstimateResult = {
  bestPosition: SalaryPosition;
  correctionFactorApplied: number;
  calibrationMode: string;
  modelSource: typeof CHROMEBB_MODEL_SOURCE;
  modelSourceConfidence: typeof CHROMEBB_MODEL_SOURCE_CONFIDENCE;
  predictedSalary: number;
  salaryByPosition: SalaryByPosition;
};

export function createEmptySalarySkills(): SalarySkills {
  return {
    driving: 0,
    handling: 0,
    insideDefense: 0,
    insideScoring: 0,
    jumpRange: 0,
    jumpShot: 0,
    outsideDefense: 0,
    passing: 0,
    rebounding: 0,
    shotBlocking: 0,
  };
}

export function ownedRosterPlayerToSalarySkills(
  player: BBApiOwnedRosterPlayer,
): SalarySkills {
  return {
    driving: player.skills.driving,
    handling: player.skills.handling,
    insideDefense: player.skills.insideDef,
    insideScoring: player.skills.insideShot,
    jumpRange: player.skills.range,
    jumpShot: player.skills.jumpShot,
    outsideDefense: player.skills.outsideDef,
    passing: player.skills.passing,
    rebounding: player.skills.rebound,
    shotBlocking: player.skills.block,
  };
}

export function normalizeSalarySkills(
  skills: Partial<Record<SalarySkillKey, number | null | undefined>>,
): SalarySkills {
  return {
    driving: Number(skills.driving ?? 0),
    handling: Number(skills.handling ?? 0),
    insideDefense: Number(skills.insideDefense ?? 0),
    insideScoring: Number(skills.insideScoring ?? 0),
    jumpRange: Number(skills.jumpRange ?? 0),
    jumpShot: Number(skills.jumpShot ?? 0),
    outsideDefense: Number(skills.outsideDefense ?? 0),
    passing: Number(skills.passing ?? 0),
    rebounding: Number(skills.rebounding ?? 0),
    shotBlocking: Number(skills.shotBlocking ?? 0),
  };
}

export function estimateChromebbSalary(args: {
  calibration?: SalaryCalibrationConfig;
  skills: SalarySkills;
}): SalaryEstimateResult {
  const calibration =
    args.calibration ?? resolveSalaryCalibration({ correctionFactor: null });
  const baseSalaryByPosition = Object.fromEntries(
    SALARY_POSITION_ORDER.map((position) => [
      position,
      chromebbAverageSalary(
        josefKaPositionSalary(args.skills, position),
        bbUsaPositionSalary(args.skills, position),
      ),
    ]),
  ) as SalaryByPosition;
  const calibratedSalaryByPosition = Object.fromEntries(
    SALARY_POSITION_ORDER.map((position) => [
      position,
      applySalaryCalibration(baseSalaryByPosition[position], calibration),
    ]),
  ) as SalaryByPosition;
  const bestPosition =
    SALARY_POSITION_ORDER.reduce<SalaryPosition>(
      (best, position) =>
        calibratedSalaryByPosition[position] >= calibratedSalaryByPosition[best]
          ? position
          : best,
      "PG",
    );

  return {
    bestPosition,
    calibrationMode: calibration.mode,
    correctionFactorApplied: calibration.correctionFactor,
    modelSource: CHROMEBB_MODEL_SOURCE,
    modelSourceConfidence: CHROMEBB_MODEL_SOURCE_CONFIDENCE,
    predictedSalary: calibratedSalaryByPosition[bestPosition],
    salaryByPosition: calibratedSalaryByPosition,
  };
}

export function resolveSalaryCalibration(args?: {
  correctionFactor?: number | null;
  mode?: string | null;
}): SalaryCalibrationConfig {
  const correctionFactor =
    typeof args?.correctionFactor === "number" &&
    Number.isFinite(args.correctionFactor) &&
    args.correctionFactor > 0
      ? args.correctionFactor
      : DEFAULT_SALARY_CORRECTION_FACTOR;

  return {
    correctionFactor,
    mode:
      typeof args?.mode === "string" && args.mode.trim()
        ? args.mode.trim()
        : DEFAULT_SALARY_CALIBRATION_MODE,
  };
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function josefKaPositionSalary(
  skills: SalarySkills,
  position: SalaryPosition,
): number {
  const multipliers = CHROMEBB_JOSEF_KA_MULTIPLIERS[position];
  const exponent = SALARY_SKILL_KEYS.reduce(
    (sum, skillKey) => sum + Math.log(multipliers[skillKey]) * skills[skillKey],
    0,
  );
  const rawSalary = CHROMEBB_JOSEF_KA_BASE * Math.exp(exponent);
  const deflatedSalary = Math.min(
    ...CHROMEBB_JOSEF_KA_DEFLATION_MODELS.map(
      (model) => rawSalary * (model.k - model.d * Math.log(rawSalary)),
    ),
  );

  return roundHalfUp(CHROMEBB_JOSEF_KA_CORRECTION_FACTOR * deflatedSalary);
}

function bbUsaPositionSalary(
  skills: SalarySkills,
  position: SalaryPosition,
): number {
  const multipliers = CHROMEBB_BB_USA_MULTIPLIERS[position];
  let salary = CHROMEBB_BB_USA_BASE;
  for (const skillKey of SALARY_SKILL_KEYS) {
    salary *= multipliers[skillKey] ** skills[skillKey];
  }

  const logEstimate = Math.log(salary);
  const params = CHROMEBB_BB_USA_ADJUSTMENT_PARAMS;
  const adjustment =
    (params.salA +
      params.salB *
        Math.exp(-((logEstimate - params.salC) ** 2) / params.salD)) *
    (1 + params.salE * logEstimate);

  return roundHalfUp(Math.exp(logEstimate / adjustment));
}

function chromebbAverageSalary(
  firstSalary: number,
  secondSalary: number,
): number {
  return roundHalfUp((firstSalary + secondSalary) / 2000) * 1000;
}

function applySalaryCalibration(
  salary: number,
  calibration: SalaryCalibrationConfig,
): number {
  return roundHalfUp(
    (salary * calibration.correctionFactor) / 1000,
  ) * 1000;
}
