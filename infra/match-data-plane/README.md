# Match Data Plane Stack

This CDK app provisions the external Python data plane:

- S3 raw, canonical, and derived storage
- DynamoDB match catalog, team projections, canonical player skill snapshots, and the app-owned active tracked teams projection
- SQS ingest/materialize queues with DLQs
- ECS/Fargate discovery, player snapshot, ingest, and materialize workers
- ECR repository for the shared Python image

Current schedules:

- Match discovery runs Wednesday through Sunday at 10:00 UTC.
- Player skill snapshots run Monday at 10:00 UTC.
- Product-side workspace refresh is manual-only; this stack no longer assumes background app refreshes.

## Deploy

1. Build and push the Python image with the workspace-root Docker context so it includes:
   - `bb-xml-api-client`
   - `bb-machine-learning`
   - `bb-machine-learning/bb-events`
2. Run:

`npm run cdk:match-data-plane:deploy`

3. Export the emitted bucket/table/queue names into the Amplify deployment environment so the app imports the external match store instead of provisioning its own.
