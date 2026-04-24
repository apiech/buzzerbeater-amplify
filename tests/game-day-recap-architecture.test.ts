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

  assert.match(
    source,
    /submitFunction\.addEnvironment\(\s*"GAME_DAY_RECAP_MODEL_ID"/,
  );
  assert.match(source, /GAME_DAY_RECAP_MODEL_ID_PREMIUM/);
  assert.match(source, /GAME_DAY_RECAP_RETRY_MODEL_ID/);
  assert.match(source, /GAME_DAY_RECAP_RETRY_MODEL_ID_PREMIUM/);
  assert.match(source, /GAME_DAY_RECAP_JUDGE_MODEL_ID/);
  assert.match(source, /GAME_DAY_RECAP_JUDGE_MODEL_ID_PREMIUM/);
  assert.match(source, /GAME_DAY_RECAP_ENFORCE_BANNED_STYLE_PHRASES/);
  assert.match(source, /GAME_DAY_RECAP_INTERVIEW_PERSONALITY_MODE/);
});

test("game day recap worker wires full-slate runtime concurrency defaults", () => {
  const jobsSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "game-day-recap-jobs.ts"),
    "utf8",
  );
  const synthSource = readFileSync(
    join(repoRoot, "amplify", "_shared", "synth-env.ts"),
    "utf8",
  );

  assert.match(jobsSource, /GAME_DAY_RECAP_CONTEXT_CONCURRENCY/);
  assert.match(jobsSource, /GAME_DAY_RECAP_JUDGE_CONCURRENCY/);
  assert.match(jobsSource, /GAME_DAY_RECAP_POLISH_CONCURRENCY/);
  assert.match(jobsSource, /GAME_DAY_RECAP_INTERVIEW_CONCURRENCY/);
  assert.match(jobsSource, /GAME_DAY_RECAP_FULL_SLATE_POLISH_MODE/);
  assert.match(synthSource, /GAME_DAY_RECAP_CONTEXT_CONCURRENCY[\s\S]*?4/);
  assert.match(synthSource, /GAME_DAY_RECAP_JUDGE_CONCURRENCY[\s\S]*?4/);
  assert.match(synthSource, /GAME_DAY_RECAP_POLISH_CONCURRENCY[\s\S]*?2/);
  assert.match(synthSource, /GAME_DAY_RECAP_INTERVIEW_CONCURRENCY[\s\S]*?2/);
  assert.match(
    synthSource,
    /normalized === "always" \|\| normalized === "off" \? normalized : "auto"/,
  );
});

test("game day recap jobs retry the completed-slate coverage business error with bounded backoff", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "_backend", "game-day-recap-jobs.ts"),
    "utf8",
  );

  assert.match(source, /RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME/);
  assert.match(
    source,
    /errors:\s*\[RETRYABLE_COMPLETED_SLATE_COVERAGE_ERROR_NAME\]/,
  );
  assert.match(source, /interval:\s*Duration\.seconds\(15\)/);
  assert.match(source, /maxAttempts:\s*2/);
  assert.match(source, /backoffRate:\s*2/);
});

test("single-lambda workflow only attaches retries when a caller provides retry props", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "_backend", "state-machine-workflow.ts"),
    "utf8",
  );

  assert.match(source, /retry\?:\s*sfn\.RetryProps/);
  assert.match(
    source,
    /if\s*\(options\.retry\)\s*\{\s*invokeWorker\.addRetry\(options\.retry\);/s,
  );
});

test("game day recap worker timeout is extended to 900 seconds", () => {
  const source = readFileSync(
    join(repoRoot, "amplify", "game-day-recap-worker", "resource.ts"),
    "utf8",
  );

  assert.match(source, /timeoutSeconds:\s*900/);
});

test("game day recap workflow catches failures through the finalizer lambda", () => {
  const workflowSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "state-machine-workflow.ts"),
    "utf8",
  );
  const jobsSource = readFileSync(
    join(repoRoot, "amplify", "_backend", "game-day-recap-jobs.ts"),
    "utf8",
  );

  assert.match(workflowSource, /failureFunction\?:\s*IFunction/);
  assert.match(workflowSource, /FinalizeFailure/);
  assert.match(workflowSource, /invokeWorker\.addCatch\(catchTarget/);
  assert.match(
    jobsSource,
    /failureFunction:\s*backend\.gameDayRecapFailureFinalizer\.resources\.lambda/,
  );
});
