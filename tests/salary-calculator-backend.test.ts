import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing as salaryCalculatorTesting,
  getManualSalaryEstimate,
  getSalaryCalculatorSeed,
} from "../amplify/data/_backend/salary-calculator";
import { estimateChromebbSalary } from "../lib/salary-calculator";

type SalaryCalculatorDependencies = NonNullable<
  Parameters<typeof getManualSalaryEstimate>[1]
>;

const guardHeavyFixtureSkills = {
  driving: 13,
  handling: 15,
  insideDefense: 4,
  insideScoring: 5,
  jumpRange: 12,
  jumpShot: 13,
  outsideDefense: 12,
  passing: 15,
  rebounding: 4,
  shotBlocking: 2,
} as const;

const plus25FixtureSkills = {
  driving: 24,
  handling: 25,
  insideDefense: 17,
  insideScoring: 18,
  jumpRange: 23,
  jumpShot: 25,
  outsideDefense: 24,
  passing: 25,
  rebounding: 16,
  shotBlocking: 12,
} as const;

test("estimateChromebbSalary matches the repo's guard-heavy manual validation fixture", () => {
  const estimate = estimateChromebbSalary({
    skills: guardHeavyFixtureSkills,
  });

  assert.deepStrictEqual(estimate, {
    bestPosition: "PG",
    calibrationMode: "IDENTITY",
    correctionFactorApplied: 1,
    modelSource: "chromebb",
    modelSourceConfidence: "direct_public_code",
    predictedSalary: 63000,
    salaryByPosition: {
      C: 1000,
      PF: 3000,
      PG: 63000,
      SF: 19000,
      SG: 29000,
    },
  });
});

test("estimateChromebbSalary supports values above 20", () => {
  const estimate = estimateChromebbSalary({
    skills: plus25FixtureSkills,
  });

  assert.deepStrictEqual(estimate, {
    bestPosition: "PG",
    calibrationMode: "IDENTITY",
    correctionFactorApplied: 1,
    modelSource: "chromebb",
    modelSourceConfidence: "direct_public_code",
    predictedSalary: 4868000,
    salaryByPosition: {
      C: 257000,
      PF: 639000,
      PG: 4868000,
      SF: 2978000,
      SG: 3452000,
    },
  });
});

test("getSalaryCalculatorSeed returns the owner-scoped synced player skills", async () => {
  const seed = await getSalaryCalculatorSeed(
    {
      env: {},
      identity: { sub: "user-1" },
      playerId: "player-1",
    },
    createDependencies({
      getOwnerTrackedPlayerProfile: async () =>
        ({
          bestPosition: "PG",
          fullName: "Seed Guard",
          id: "player-1",
          salary: 325000,
          skills: {
            block: 4,
            driving: 24,
            experience: 7,
            freeThrow: 8,
            gameShape: 9,
            handling: 25,
            insideDef: 11,
            insideShot: 9,
            jumpShot: 25,
            outsideDef: 24,
            passing: 25,
            potential: 12,
            range: 23,
            rebound: 8,
            stamina: 8,
          },
        }) as any,
    }),
  );

  assert.deepStrictEqual(seed, {
    bestPosition: "PG",
    currentSalary: 325000,
    fullName: "Seed Guard",
    playerId: "player-1",
    skills: {
      driving: 24,
      handling: 25,
      insideDefense: 11,
      insideScoring: 9,
      jumpRange: 23,
      jumpShot: 25,
      outsideDefense: 24,
      passing: 25,
      rebounding: 8,
      shotBlocking: 4,
    },
  });
});

test("getSalaryCalculatorSeed rejects players without a synced owner profile", async () => {
  await assert.rejects(
    () =>
      getSalaryCalculatorSeed(
        {
          env: {},
          identity: { sub: "user-1" },
          playerId: "player-1",
        },
        createDependencies({
          getOwnerTrackedPlayerProfile: async () => null,
        }),
      ),
    /does not have a synced skill profile yet/i,
  );
});

test("getSalaryCalculatorSeed preserves owner workspace scoping errors", async () => {
  await assert.rejects(
    () =>
      getSalaryCalculatorSeed(
        {
          env: {},
          identity: { sub: "user-1" },
          playerId: "player-1",
        },
        createDependencies({
          getOwnerTrackedPlayerProfile: async () => {
            throw new Error(
              "The requested player is not available in the current workspace.",
            );
          },
        }),
      ),
    /not available in the current workspace/i,
  );
});

test("getManualSalaryEstimate validates bounds and whole-number inputs", async () => {
  await assert.rejects(
    () =>
      getManualSalaryEstimate(
        {
          identity: { sub: "user-1" },
          input: {
            skills: {
              ...guardHeavyFixtureSkills,
              jumpShot: 0,
            },
          },
        },
        createDependencies(),
      ),
    /Jump Shot must be between 1 and 99\./,
  );

  await assert.rejects(
    () =>
      getManualSalaryEstimate(
        {
          identity: { sub: "user-1" },
          input: {
            skills: {
              ...guardHeavyFixtureSkills,
              jumpShot: 100,
            },
          },
        },
        createDependencies(),
      ),
    /Jump Shot must be between 1 and 99\./,
  );

  await assert.rejects(
    () =>
      getManualSalaryEstimate(
        {
          identity: { sub: "user-1" },
          input: {
            skills: {
              ...guardHeavyFixtureSkills,
              jumpShot: 12.5,
            },
          },
        },
        createDependencies(),
      ),
    /Jump Shot must be a whole number\./,
  );
});

test("getManualSalaryEstimate returns identity calibration metadata in PG-through-C order", async () => {
  const estimate = await getManualSalaryEstimate(
    {
      identity: { sub: "user-1" },
      input: {
        skills: plus25FixtureSkills,
      },
    },
    createDependencies(),
  );

  assert.equal(estimate.bestPosition, "PG");
  assert.equal(estimate.predictedSalary, 4868000);
  assert.equal(estimate.modelSource, "chromebb");
  assert.equal(estimate.modelSourceConfidence, "direct_public_code");
  assert.equal(estimate.calibrationMode, "IDENTITY");
  assert.equal(estimate.correctionFactorApplied, 1);
  assert.deepStrictEqual(Object.keys(estimate.salaryByPosition), [
    "PG",
    "SG",
    "SF",
    "PF",
    "C",
  ]);
  assert.deepStrictEqual(estimate.salaryByPosition, {
    PG: 4868000,
    SG: 3452000,
    SF: 2978000,
    PF: 639000,
    C: 257000,
  });
});

function createDependencies(
  overrides: Partial<SalaryCalculatorDependencies> = {},
): SalaryCalculatorDependencies {
  return {
    ...salaryCalculatorTesting.defaultDependencies,
    assertMaintenanceInactive: async () => {},
    resolveUserId: () => "user-1",
    ...overrides,
  };
}
