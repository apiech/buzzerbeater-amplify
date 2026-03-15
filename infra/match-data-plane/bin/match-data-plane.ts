#!/usr/bin/env node
import { App } from "aws-cdk-lib";

import { MatchDataPlaneStack } from "../lib/match-data-plane-stack";

const app = new App();
const encryptionSecret =
  app.node.tryGetContext("bbConnectionEncryptionSecret") ??
  process.env.BB_CONNECTION_ENCRYPTION_SECRET;

if (!encryptionSecret) {
  throw new Error(
    "BB_CONNECTION_ENCRYPTION_SECRET must be set or passed via the bbConnectionEncryptionSecret CDK context.",
  );
}

new MatchDataPlaneStack(app, "MatchDataPlane", {
  imageTag:
    app.node.tryGetContext("imageTag") ??
    process.env.MATCH_DATA_PLANE_IMAGE_TAG ??
    "latest",
  encryptionSecret,
});
