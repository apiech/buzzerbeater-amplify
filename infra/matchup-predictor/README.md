# Matchup Predictor Stack

This CDK app provisions the SageMaker Serverless endpoint that the web app
expects for matchup predictions.

It owns:

- the serving image asset built from `bb-machine-learning/apps/matchup_predictor/serverless`
- the packaged `model.tar.gz` asset built from the default XGBoost bundle inputs in `bb-machine-learning/apps/matchup_predictor/april2025`
- the SageMaker execution role, model, endpoint config, and stable endpoint

Stable endpoint names:

- `bb-matchup-predictor-dev`
- `bb-matchup-predictor-prod`

## Supported Release Flow

Use the repo-root wrapper instead of raw CDK commands:

```bash
./scripts/matchup-predictor-release dev --release-id <release-id> --artifact-prefix <absolute-artifact-stem>
./scripts/matchup-predictor-release prod --release-id <release-id>
```

That wrapper:

- snapshots one chosen model/config artifact pair into the repo-local release directory
- packages an explicit local tarball through this CDK app
- waits for SageMaker
- smoke tests the endpoint
- records the release manifest used for later `prod` promotion

Runbook: [`docs/runbooks/matchup-predictor-release.md`](/Users/karey/projects/bb/docs/runbooks/matchup-predictor-release.md)

## Raw CDK Debugging

The `npm run cdk:matchup-predictor:*` scripts in [`package.json`](/Users/karey/projects/bb/bb-amplify/package.json) remain available for synth checks and infrastructure debugging. They are not the documented operator workflow.
