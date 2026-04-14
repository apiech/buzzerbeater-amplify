import type { BBApiOwnedRosterPlayer } from "../../../lib/bbapi";
import { ownedRosterPlayerToSalarySkills } from "../../../lib/salary-calculator";
import {
  estimateChromebbSalary,
  resolveSalaryCalibration,
  type SalaryCalibrationConfig,
  type SalaryEstimateResult,
  type SalarySkills,
} from "../../../lib/salary-calculator";
import type { Schema } from "../resource";
import { getOwnerTrackedPlayerProfile } from "./player-snapshot-access";
import { assertMaintenanceInactive } from "./maintenance";
import { resolveUserId } from "./workspace-connection";

type GraphqlEnv = Record<string, string | undefined>;

type ResolverResult<TKey extends keyof Schema> = NonNullable<
  Schema[TKey] extends { returnType: infer TReturn } ? TReturn : never
>;

type ManualSalaryEstimateInput = NonNullable<
  NonNullable<Schema["getManualSalaryEstimate"]["args"]>["input"]
>;
type SalaryCalculatorSeedResult = ResolverResult<"getSalaryCalculatorSeed">;
type ManualSalaryEstimateResult = ResolverResult<"getManualSalaryEstimate">;
type AssertMaintenanceInactive = () => Promise<void>;
type EstimateChromebbSalary = (args: {
  calibration?: SalaryCalibrationConfig;
  skills: SalarySkills;
}) => SalaryEstimateResult;
type GetOwnerTrackedPlayerProfile = (
  env: GraphqlEnv,
  userId: string,
  playerId: string,
) => Promise<BBApiOwnedRosterPlayer | null>;
type ResolveSalaryCalibration = (args?: {
  correctionFactor?: number | null;
  mode?: string | null;
}) => SalaryCalibrationConfig;
type ResolveUserId = (identity: unknown) => string | null;

type SalaryCalculatorDependencies = {
  assertMaintenanceInactive: AssertMaintenanceInactive;
  estimateChromebbSalary: EstimateChromebbSalary;
  getOwnerTrackedPlayerProfile: GetOwnerTrackedPlayerProfile;
  resolveSalaryCalibration: ResolveSalaryCalibration;
  resolveUserId: ResolveUserId;
};

const SALARY_SKILL_BOUNDS = {
  max: 99,
  min: 1,
} as const;

const defaultDependencies: SalaryCalculatorDependencies = {
  assertMaintenanceInactive,
  estimateChromebbSalary,
  getOwnerTrackedPlayerProfile,
  resolveSalaryCalibration,
  resolveUserId,
};

export const __testing = {
  defaultDependencies,
  normalizeSalaryCalculatorInput,
  toSalaryCalculatorSeedPayload,
};

export async function getSalaryCalculatorSeed(args: {
  env: GraphqlEnv;
  identity: unknown;
  playerId: string;
}, dependencies: SalaryCalculatorDependencies = defaultDependencies): Promise<SalaryCalculatorSeedResult> {
  await dependencies.assertMaintenanceInactive();

  const userId = dependencies.resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  const playerId = args.playerId.trim();
  if (!playerId) {
    throw new Error("A player id is required.");
  }

  const profile = await dependencies.getOwnerTrackedPlayerProfile(
    args.env,
    userId,
    playerId,
  );
  if (!profile) {
    throw new Error("The requested player does not have a synced skill profile yet.");
  }

  return toSalaryCalculatorSeedPayload(profile);
}

export async function getManualSalaryEstimate(args: {
  identity: unknown;
  input: ManualSalaryEstimateInput;
}, dependencies: SalaryCalculatorDependencies = defaultDependencies): Promise<ManualSalaryEstimateResult> {
  await dependencies.assertMaintenanceInactive();

  const userId = dependencies.resolveUserId(args.identity);
  if (!userId) {
    throw new Error("Authenticated user identity is missing.");
  }

  void userId;

  const normalizedSkills = normalizeSalaryCalculatorInput(args.input);
  const estimate = dependencies.estimateChromebbSalary({
    calibration: dependencies.resolveSalaryCalibration(),
    skills: normalizedSkills,
  });

  return {
    bestPosition: estimate.bestPosition,
    calibrationMode: estimate.calibrationMode,
    correctionFactorApplied: estimate.correctionFactorApplied,
    modelSource: estimate.modelSource,
    modelSourceConfidence: estimate.modelSourceConfidence,
    predictedSalary: estimate.predictedSalary,
    salaryByPosition: estimate.salaryByPosition,
  };
}

export function normalizeSalaryCalculatorInput(
  input: ManualSalaryEstimateInput,
): SalarySkills {
  const skills = input.skills;

  return {
    driving: parseSalarySkillValue(skills.driving, "Driving"),
    handling: parseSalarySkillValue(skills.handling, "Handling"),
    insideDefense: parseSalarySkillValue(
      skills.insideDefense,
      "Inside Defense",
    ),
    insideScoring: parseSalarySkillValue(
      skills.insideScoring,
      "Inside Scoring",
    ),
    jumpRange: parseSalarySkillValue(skills.jumpRange, "Jump Range"),
    jumpShot: parseSalarySkillValue(skills.jumpShot, "Jump Shot"),
    outsideDefense: parseSalarySkillValue(
      skills.outsideDefense,
      "Outside Defense",
    ),
    passing: parseSalarySkillValue(skills.passing, "Passing"),
    rebounding: parseSalarySkillValue(skills.rebounding, "Rebounding"),
    shotBlocking: parseSalarySkillValue(
      skills.shotBlocking,
      "Shot Blocking",
    ),
  };
}

function toSalaryCalculatorSeedPayload(
  profile: BBApiOwnedRosterPlayer,
): SalaryCalculatorSeedResult {
  return {
    bestPosition: profile.bestPosition,
    currentSalary: profile.salary,
    fullName: profile.fullName,
    playerId: profile.id,
    skills: ownedRosterPlayerToSalarySkills(profile),
  };
}

function parseSalarySkillValue(value: number | null | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }

  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be a whole number.`);
  }

  if (value < SALARY_SKILL_BOUNDS.min || value > SALARY_SKILL_BOUNDS.max) {
    throw new Error(
      `${label} must be between ${SALARY_SKILL_BOUNDS.min} and ${SALARY_SKILL_BOUNDS.max}.`,
    );
  }

  return value;
}
