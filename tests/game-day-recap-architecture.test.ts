import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(currentDir, "..");

test("game day recap jobs grant Bedrock Marketplace auto-enablement permissions", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "_backend", "game-day-recap-jobs.ts"),
    "utf8",
  );

  assert.match(source, /aws-marketplace:Subscribe/);
  assert.match(source, /aws-marketplace:ViewSubscriptions/);
  assert.match(source, /aws-marketplace:Unsubscribe/);
  assert.match(source, /aws:CalledViaLast/);
  assert.match(source, /bedrock\.amazonaws\.com/);
});

test("game day recap jobs wire routing env vars into recap submit lambdas", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "_backend", "game-day-recap-jobs.ts"),
    "utf8",
  );

  assert.match(source, /gameDayRecapSubmit\.addEnvironment\(\s*"GAME_DAY_RECAP_MODEL_ID"/);
  assert.match(source, /submitLeagueGameDayRecap\.addEnvironment\(\s*"GAME_DAY_RECAP_MODEL_ID"/);
  assert.match(source, /submitSingleGameSummary\.addEnvironment\(\s*"GAME_DAY_RECAP_MODEL_ID"/);
  assert.match(source, /GAME_DAY_RECAP_MODEL_ID_PREMIUM/);
});
