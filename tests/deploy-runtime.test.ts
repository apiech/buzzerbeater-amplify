import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createOpponentForecastTargetPin,
  createPredictorTargetPin,
  inspectOpponentForecastTargetPin,
  inspectPredictorTargetPin,
  loadDeployLocalEnvFile,
  resolveOpponentForecastTargetPin,
  resolvePredictorTargetPin,
  writeOpponentForecastTargetPin,
  writePredictorTargetPin,
} from "../scripts/deploy-runtime.ts";

test("loadDeployLocalEnvFile loads the workspace deploy env file when it exists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-deploy-env-"));
  let loadedPath = null;

  try {
    writeFileSync(join(tempDir, ".env.deploy.local"), "KEY=value\n", "utf8");

    const returnedPath = loadDeployLocalEnvFile(tempDir, {
      env: {},
      loadEnvFile(path) {
        loadedPath = path;
      },
    });

    assert.equal(returnedPath, join(tempDir, ".env.deploy.local"));
    assert.equal(loadedPath, returnedPath);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("writePredictorTargetPin persists one ready predictor pin", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-predictor-pin-"));
  const artifactPrefix = join(tempDir, "ratings_universal_xgb_all");
  const targetsPath = join(tempDir, "targets.local.json");

  try {
    writeFileSync(`${artifactPrefix}_model.pkl`, "model", "utf8");
    writeFileSync(`${artifactPrefix}_config.pkl`, "config", "utf8");

    const pin = createPredictorTargetPin(
      "ratings-universal-xgb-2026-03-19",
      artifactPrefix,
      {
        nowIso: () => "2026-03-19T12:00:00.000Z",
      },
    );
    writePredictorTargetPin("sandbox", pin, targetsPath);

    const inspection = inspectPredictorTargetPin("sandbox", targetsPath);
    if (inspection.status !== "ready") {
      assert.fail("predictor pin should have been ready");
    }
    assert.deepEqual(inspection.pin, pin);
    assert.equal(
      resolvePredictorTargetPin("sandbox", targetsPath).releaseId,
      "ratings-universal-xgb-2026-03-19",
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("inspectPredictorTargetPin reports missing artifact files as invalid", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-predictor-pin-invalid-"));
  const artifactPrefix = join(tempDir, "ratings_universal_xgb_all");
  const targetsPath = join(tempDir, "targets.local.json");

  try {
    writeFileSync(
      targetsPath,
      JSON.stringify(
        {
          sandbox: {
            artifactPrefix,
            releaseId: "ratings-universal-xgb-2026-03-19",
            updatedAt: "2026-03-19T12:00:00.000Z",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const inspection = inspectPredictorTargetPin("sandbox", targetsPath);
    if (inspection.status !== "invalid") {
      assert.fail("predictor pin should have been invalid");
    }
    assert.match(inspection.message, /missing model file/);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("writeOpponentForecastTargetPin persists one ready opponent forecast pin", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-opponent-forecast-pin-"));
  const datasetRoot = join(tempDir, "dataset");
  const targetsPath = join(tempDir, "targets.local.json");

  try {
    mkdirSync(datasetRoot, { recursive: true });
    writeFileSync(join(datasetRoot, "team_match_prestate.parquet"), "prestate", "utf8");
    writeFileSync(join(datasetRoot, "team_match_labels.parquet"), "labels", "utf8");

    const pin = createOpponentForecastTargetPin(
      "opponent-forecast-v1-2026-03-19",
      datasetRoot,
      {
        nowIso: () => "2026-03-19T12:00:00.000Z",
      },
    );
    writeOpponentForecastTargetPin("sandbox", pin, targetsPath);

    const inspection = inspectOpponentForecastTargetPin("sandbox", targetsPath);
    if (inspection.status !== "ready") {
      assert.fail("opponent forecast pin should have been ready");
    }
    assert.deepEqual(inspection.pin, pin);
    assert.equal(
      resolveOpponentForecastTargetPin("sandbox", targetsPath).releaseId,
      "opponent-forecast-v1-2026-03-19",
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("inspectOpponentForecastTargetPin reports missing parquet files as invalid", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-opponent-forecast-pin-invalid-"));
  const datasetRoot = join(tempDir, "dataset");
  const targetsPath = join(tempDir, "targets.local.json");

  try {
    mkdirSync(datasetRoot, { recursive: true });
    writeFileSync(
      targetsPath,
      JSON.stringify(
        {
          sandbox: {
            datasetRoot,
            releaseId: "opponent-forecast-v1-2026-03-19",
            updatedAt: "2026-03-19T12:00:00.000Z",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const inspection = inspectOpponentForecastTargetPin("sandbox", targetsPath);
    if (inspection.status !== "invalid") {
      assert.fail("opponent forecast pin should have been invalid");
    }
    assert.match(inspection.message, /missing prestate file/);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
