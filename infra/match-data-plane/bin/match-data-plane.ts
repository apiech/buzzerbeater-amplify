#!/usr/bin/env node
import { App } from "aws-cdk-lib";

import { MatchDataPlaneStack } from "../lib/match-data-plane-stack";

const app = new App();

new MatchDataPlaneStack(app, "MatchDataPlane", {
  imageTag:
    app.node.tryGetContext("imageTag") ??
    process.env.MATCH_DATA_PLANE_IMAGE_TAG ??
    "latest",
  secretPrefix:
    app.node.tryGetContext("secretPrefix") ??
    process.env.BB_CONNECTION_SECRET_PREFIX ??
    "bb-connections",
});
