import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    writeFileSync(`${artifactPrefix}_model.ubj`, "model", "utf8");
    writeFileSync(`${artifactPrefix}_config.json`, "config", "utf8");

    const pin = createPredictorTargetPin(
      "ratings-universal-xgb-2026-03-19",
      artifactPrefix,
      {
        nowIso: () => "2026-03-19T12:00:00.000Z",
      },
    );
    writePredictorTargetPin("sandbox", pin, targetsPath, createPinRuntime(), {
      sandboxIdentifier: "karey",
    });

    const inspection = inspectPredictorTargetPin(
      "sandbox",
      targetsPath,
      createReadPinRuntime(),
      {
        sandboxIdentifier: "karey",
      },
    );
    if (inspection.status !== "ready") {
      assert.fail("predictor pin should have been ready");
    }
    assert.deepEqual(inspection.pin, pin);
    assert.equal(
      resolvePredictorTargetPin("sandbox", targetsPath, createReadPinRuntime(), {
        sandboxIdentifier: "karey",
      }).releaseId,
      "ratings-universal-xgb-2026-03-19",
    );
    const written = JSON.parse(readFileSync(targetsPath, "utf8"));
    assert.deepEqual(written, {
      sandboxes: {
        karey: pin,
      },
    });
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("inspectPredictorTargetPin falls back to the legacy sandbox pin when no scoped entry exists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-predictor-pin-invalid-"));
  const artifactPrefix = join(tempDir, "ratings_universal_xgb_all");
  const targetsPath = join(tempDir, "targets.local.json");

  try {
    writeFileSync(`${artifactPrefix}_model.ubj`, "model", "utf8");
    writeFileSync(`${artifactPrefix}_config.json`, "config", "utf8");
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

    const inspection = inspectPredictorTargetPin(
      "sandbox",
      targetsPath,
      createReadPinRuntime(),
      {
        sandboxIdentifier: "karey",
      },
    );
    if (inspection.status !== "ready") {
      assert.fail("predictor pin should have used the legacy fallback");
    }
    assert.equal(inspection.pin.releaseId, "ratings-universal-xgb-2026-03-19");
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
          sandboxes: {
            karey: {
              artifactPrefix,
              releaseId: "ratings-universal-xgb-2026-03-19",
              updatedAt: "2026-03-19T12:00:00.000Z",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const inspection = inspectPredictorTargetPin(
      "sandbox",
      targetsPath,
      createReadPinRuntime(),
      {
        sandboxIdentifier: "karey",
      },
    );
    if (inspection.status !== "invalid") {
      assert.fail("predictor pin should have been invalid");
    }
    assert.match(inspection.message, /sandbox:karey/);
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
    writeOpponentForecastTargetPin("sandbox", pin, targetsPath, createPinRuntime(), {
      sandboxIdentifier: "karey",
    });

    const inspection = inspectOpponentForecastTargetPin(
      "sandbox",
      targetsPath,
      createReadPinRuntime(),
      {
        sandboxIdentifier: "karey",
      },
    );
    if (inspection.status !== "ready") {
      assert.fail("opponent forecast pin should have been ready");
    }
    assert.deepEqual(inspection.pin, pin);
    assert.equal(
      resolveOpponentForecastTargetPin(
        "sandbox",
        targetsPath,
        createReadPinRuntime(),
        {
          sandboxIdentifier: "karey",
        },
      ).releaseId,
      "opponent-forecast-v1-2026-03-19",
    );
    const written = JSON.parse(readFileSync(targetsPath, "utf8"));
    assert.deepEqual(written, {
      sandboxes: {
        karey: pin,
      },
    });
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("inspectOpponentForecastTargetPin falls back to the legacy sandbox pin when no scoped entry exists", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bb-opponent-forecast-pin-invalid-"));
  const datasetRoot = join(tempDir, "dataset");
  const targetsPath = join(tempDir, "targets.local.json");

  try {
    mkdirSync(datasetRoot, { recursive: true });
    writeFileSync(join(datasetRoot, "team_match_prestate.parquet"), "prestate", "utf8");
    writeFileSync(join(datasetRoot, "team_match_labels.parquet"), "labels", "utf8");
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

    const inspection = inspectOpponentForecastTargetPin(
      "sandbox",
      targetsPath,
      createReadPinRuntime(),
      {
        sandboxIdentifier: "karey",
      },
    );
    if (inspection.status !== "ready") {
      assert.fail("opponent forecast pin should have used the legacy fallback");
    }
    assert.equal(inspection.pin.releaseId, "opponent-forecast-v1-2026-03-19");
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
          sandboxes: {
            karey: {
              datasetRoot,
              releaseId: "opponent-forecast-v1-2026-03-19",
              updatedAt: "2026-03-19T12:00:00.000Z",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const inspection = inspectOpponentForecastTargetPin(
      "sandbox",
      targetsPath,
      createReadPinRuntime(),
      {
        sandboxIdentifier: "karey",
      },
    );
    if (inspection.status !== "invalid") {
      assert.fail("opponent forecast pin should have been invalid");
    }
    assert.match(inspection.message, /sandbox:karey/);
    assert.match(inspection.message, /missing prestate file/);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

function createReadPinRuntime() {
  return {
    fileExists(path: string) {
      return existsSync(path);
    },
    readFile(path: string) {
      return readFileSync(path, "utf8");
    },
  };
}

function createPinRuntime() {
  return {
    ...createReadPinRuntime(),
    mkdirp(path: string) {
      mkdirSync(path, { recursive: true });
    },
    writeFile(path: string, contents: string) {
      writeFileSync(path, contents, "utf8");
    },
  };
}
