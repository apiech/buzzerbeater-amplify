#!/usr/bin/env node
import { existsSync } from "node:fs";
import { App } from "aws-cdk-lib";

import {
  MatchupPredictorStack,
  type MatchupPredictorStage,
} from "../lib/matchup-predictor-stack";

const TARGET_ACCOUNT = "427377913956";
const TARGET_REGION = "us-east-1";

const app = new App();
const stage = resolveStage(
  app.node.tryGetContext("stage") ??
    process.env.MATCHUP_PREDICTOR_STAGE ??
    "dev",
);
const modelVersion = resolveOptionalString(
  app.node.tryGetContext("modelVersion") ??
    process.env.MATCHUP_PREDICTOR_MODEL_VERSION,
);
const modelTarballPath = resolveModelTarballPath(
  app.node.tryGetContext("modelTarballPath") ??
    process.env.MATCHUP_PREDICTOR_MODEL_TARBALL_PATH,
);

new MatchupPredictorStack(app, stackIdForStage(stage), {
  stage,
  modelVersion,
  modelTarballPath,
  env: {
    account: TARGET_ACCOUNT,
    region: TARGET_REGION,
  },
});

function resolveStage(value: string): MatchupPredictorStage {
  const normalized = value.toLowerCase();
  if (normalized === "dev" || normalized === "prod") {
    return normalized;
  }

  throw new Error("stage must be either dev or prod.");
}

function stackIdForStage(stage: MatchupPredictorStage): string {
  return stage === "prod" ? "MatchupPredictorProd" : "MatchupPredictorDev";
}

function resolveOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveModelTarballPath(value: unknown): string | undefined {
  const normalized = resolveOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (!normalized.startsWith("/")) {
    throw new Error("modelTarballPath must be an absolute filesystem path.");
  }

  if (!existsSync(normalized)) {
    throw new Error(
      `modelTarballPath does not exist on disk: ${normalized}`,
    );
  }

  return normalized;
}
