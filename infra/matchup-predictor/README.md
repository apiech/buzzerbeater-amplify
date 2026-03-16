# Matchup Predictor Stack

This CDK app provisions the SageMaker Serverless endpoint that the web app
expects for matchup predictions.

It owns:

- the serving image asset built from `bb-machine-learning/apps/matchup_predictor/serverless`
- the packaged `model.tar.gz` asset built from the committed default model bundle
- the SageMaker execution role, model, endpoint config, and stable endpoint

Stable endpoint names:

- `bb-matchup-predictor-dev`
- `bb-matchup-predictor-prod`

## Deploy

1. Ensure the target account is `427377913956` in `us-east-1` and CDK bootstrap is present.
2. From `bb-amplify`, run:

`npm run cdk:matchup-predictor:deploy:dev`

3. After the endpoint reaches `InService`, the Amplify prediction worker can invoke it without any application code changes.

Use the matching `prod` script when you are ready to provision the production endpoint.
