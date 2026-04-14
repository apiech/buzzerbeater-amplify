import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStaffBidSearchParams,
  calculateStaffBidResult,
  calculateStaffGrowthFactor,
  MINIMUM_STAFF_BID,
  parseStaffBidFormState,
  readStaffBidFormStateFromSearchParams,
  type StaffBidFormState,
} from "../app/staff-market";

function createValidFormState(
  overrides: Partial<StaffBidFormState> = {},
): StaffBidFormState {
  return {
    budgetCap: "250000",
    budgetMode: "ALL_IN",
    candidateLevel: "4",
    candidateRole: "Doctor",
    candidateWeeklySalary: "9000",
    currentLevel: "3",
    currentRole: "Doctor",
    currentWeeklySalary: "12000",
    horizonWeeks: "13",
    proposedBid: "20000",
    ...overrides,
  };
}

test("staff growth factors follow the level formula from 1 through 7", () => {
  for (let level = 1; level <= 7; level += 1) {
    assert.equal(calculateStaffGrowthFactor(level), 1.01 + 0.025 * level);
  }
});

test("staff bid result applies severance exactly once", () => {
  const parsed = parseStaffBidFormState(
    createValidFormState({
      candidateWeeklySalary: "14000",
      currentWeeklySalary: "10000",
      proposedBid: "25000",
    }),
  );
  assert.ok(parsed.scenario);

  const result = calculateStaffBidResult(parsed.scenario);
  const candidateSalaryTotal = result.candidateSeries.at(-1)?.cumulativeCost ?? 0;

  assert.equal(result.severance, 10000);
  assert.equal(result.todayCashOutlay, 35000);
  assert.equal(result.replaceCost - candidateSalaryTotal - 25000, 10000);
});

test("same-level lower-salary replacements can produce a payback week", () => {
  const parsed = parseStaffBidFormState(
    createValidFormState({
      candidateLevel: "4",
      candidateWeeklySalary: "9000",
      currentLevel: "4",
      currentWeeklySalary: "12000",
      proposedBid: "5000",
    }),
  );
  assert.ok(parsed.scenario);

  const result = calculateStaffBidResult(parsed.scenario);

  assert.notEqual(result.paybackWeek, null);
  assert.ok((result.paybackWeek ?? 0) > 0);
});

test("higher-level expensive candidates return pass when the bid exceeds the ceiling", () => {
  const parsed = parseStaffBidFormState(
    createValidFormState({
      budgetCap: "150000",
      candidateLevel: "7",
      candidateWeeklySalary: "18000",
      currentLevel: "3",
      currentWeeklySalary: "7000",
      proposedBid: "75000",
    }),
  );
  assert.ok(parsed.scenario);

  const result = calculateStaffBidResult(parsed.scenario);

  assert.equal(result.decision, "PASS");
  assert.ok(result.proposedBid > result.maxRationalBid);
});

test("budget modes compute distinct max rational bids", () => {
  const allInParsed = parseStaffBidFormState(
    createValidFormState({
      budgetCap: "300000",
      budgetMode: "ALL_IN",
      candidateWeeklySalary: "10000",
      currentWeeklySalary: "8000",
      proposedBid: "1000",
    }),
  );
  const premiumParsed = parseStaffBidFormState(
    createValidFormState({
      budgetCap: "300000",
      budgetMode: "UPGRADE_PREMIUM",
      candidateWeeklySalary: "10000",
      currentWeeklySalary: "8000",
      proposedBid: "1000",
    }),
  );
  assert.ok(allInParsed.scenario);
  assert.ok(premiumParsed.scenario);

  const allIn = calculateStaffBidResult(allInParsed.scenario);
  const premium = calculateStaffBidResult(premiumParsed.scenario);

  assert.equal(
    allIn.maxRationalBid,
    300000 -
      allIn.severance -
      (allIn.candidateSeries.at(-1)?.cumulativeCost ?? 0),
  );
  assert.equal(
    premium.maxRationalBid,
    allIn.maxRationalBid + allIn.keepCost,
  );
});

test("staff costs respond to short, season, and long horizons", () => {
  const shortParsed = parseStaffBidFormState(
    createValidFormState({ horizonWeeks: "4" }),
  );
  const seasonParsed = parseStaffBidFormState(
    createValidFormState({ horizonWeeks: "13" }),
  );
  const longParsed = parseStaffBidFormState(
    createValidFormState({ horizonWeeks: "26" }),
  );
  assert.ok(shortParsed.scenario);
  assert.ok(seasonParsed.scenario);
  assert.ok(longParsed.scenario);

  const shortResult = calculateStaffBidResult(shortParsed.scenario);
  const seasonResult = calculateStaffBidResult(seasonParsed.scenario);
  const longResult = calculateStaffBidResult(longParsed.scenario);

  assert.ok(shortResult.keepCost < seasonResult.keepCost);
  assert.ok(seasonResult.keepCost < longResult.keepCost);
  assert.ok(shortResult.replaceCost < seasonResult.replaceCost);
  assert.ok(seasonResult.replaceCost < longResult.replaceCost);
});

test("bids below 1000 are treated as invalid no-bid territory", () => {
  const parsed = parseStaffBidFormState(
    createValidFormState({ proposedBid: "999" }),
  );
  assert.ok(parsed.scenario);
  assert.match(parsed.errors.proposedBid ?? "", /below 1,000/i);

  const result = calculateStaffBidResult(parsed.scenario);
  assert.equal(result.decision, "INVALID");
});

test("form validation rejects bad salary, bid, level, and missing budget cap inputs", () => {
  const parsed = parseStaffBidFormState(
    createValidFormState({
      budgetCap: "",
      candidateLevel: "0",
      candidateWeeklySalary: "-3",
      currentLevel: "9",
      proposedBid: "ten thousand",
    }),
  );

  assert.equal(parsed.scenario, null);
  assert.match(parsed.errors.currentLevel ?? "", /1 to 7/i);
  assert.match(parsed.errors.candidateLevel ?? "", /1 to 7/i);
  assert.match(parsed.errors.candidateWeeklySalary ?? "", /whole number/i);
  assert.match(parsed.errors.proposedBid ?? "", /whole number/i);
  assert.ok(parsed.missingFields.includes("budgetCap"));
});

test("staff market URL params round-trip back into the same scenario form", () => {
  const formState = createValidFormState({
    budgetCap: "375000",
    budgetMode: "UPGRADE_PREMIUM",
    candidateLevel: "6",
    candidateRole: "Trainer",
    candidateWeeklySalary: "15000",
    currentLevel: "2",
    currentRole: "PR Manager",
    currentWeeklySalary: "7000",
    horizonWeeks: "26",
    proposedBid: String(MINIMUM_STAFF_BID + 25000),
  });

  const params = buildStaffBidSearchParams(formState);
  const hydrated = readStaffBidFormStateFromSearchParams(params);

  assert.deepStrictEqual(hydrated, formState);
});
