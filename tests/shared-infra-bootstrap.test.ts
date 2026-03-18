import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSandboxPredictorReady,
  bootstrapSandboxSharedInfra,
  buildSandboxPredictorReleaseCommand,
  createSharedInfraBootstrapCommand,
  resolveSandboxEnvironmentName,
  resolveSandboxIdentifier,
  shouldBootstrapSandboxSharedInfra,
} from "../scripts/shared-infra-bootstrap.mjs";

test("sandbox shared infra bootstrap only runs for sandbox deploy commands", () => {
  assert.equal(shouldBootstrapSandboxSharedInfra(["sandbox"]), true);
  assert.equal(
    shouldBootstrapSandboxSharedInfra(["sandbox", "--identifier", "karey"]),
    true,
  );
  assert.equal(
    shouldBootstrapSandboxSharedInfra(["sandbox", "delete"]),
    false,
  );
  assert.equal(
    shouldBootstrapSandboxSharedInfra(["sandbox", "secret", "set", "KEY"]),
    false,
  );
  assert.equal(shouldBootstrapSandboxSharedInfra(["sandbox", "--help"]), false);
});

test("sandbox bootstrap resolves identifiers and environment names deterministically", () => {
  assert.equal(
    resolveSandboxIdentifier(["sandbox", "--identifier", "Karey Local"]),
    "karey-local",
  );
  assert.equal(
    resolveSandboxEnvironmentName(["sandbox", "--identifier", "Karey Local"]),
    "sandbox-karey-local",
  );
  assert.equal(
    resolveSandboxIdentifier(["sandbox"], {
      userName: () => "Karey",
    }),
    "karey",
  );
});

test("sandbox bootstrap shells out to the shared infra workspace with the sandbox identity", () => {
  let spawnInput = null;

  const result = bootstrapSandboxSharedInfra(["sandbox", "--identifier", "Karey"], {
    directoryExists: () => true,
    env: {
      BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
    },
    spawnSync: (command, args, options) => {
      spawnInput = { args, command, options };
      return { status: 0 };
    },
    userName: () => "ignored",
  });

  assert.deepEqual(result, {
    environmentName: "sandbox-karey",
    sandboxIdentifier: "karey",
  });
  assert.ok(spawnInput);
  assert.equal(spawnInput.command, process.platform === "win32" ? "npm.cmd" : "npm");
  assert.deepEqual(spawnInput.args.slice(-2), ["--sandbox-identifier", "karey"]);
  assert.match(spawnInput.args.join(" "), /bb-shared-infra/);
  assert.equal(
    spawnInput.options?.env?.BB_SHARED_ENVIRONMENT_NAME,
    "sandbox-karey",
  );
});

test("sandbox bootstrap fails fast when the shared encryption secret is unavailable", () => {
  assert.throws(
    () =>
      bootstrapSandboxSharedInfra(["sandbox"], {
        directoryExists: () => true,
        env: {},
        spawnSync: () => ({ status: 0 }),
        userName: () => "karey",
      }),
    /BB_CONNECTION_ENCRYPTION_SECRET must be set before bootstrapping shared infra/,
  );
});

test("shared infra bootstrap command targets the shared workspace deploy script", () => {
  const command = createSharedInfraBootstrapCommand([
    "sandbox",
    "--identifier=karey",
  ]);

  assert.equal(command.environmentName, "sandbox-karey");
  assert.equal(command.sandboxIdentifier, "karey");
  assert.deepEqual(command.args.slice(-4), [
    "deploy:ml-data-infra",
    "--",
    "--sandbox-identifier",
    "karey",
  ]);
});

test("sandbox predictor release command defaults the identifier from the current username", () => {
  const releaseCommand = buildSandboxPredictorReleaseCommand(["sandbox"], {
    userName: () => "Karey",
  });

  assert.equal(releaseCommand.environmentName, "sandbox-karey");
  assert.equal(releaseCommand.sandboxIdentifier, "karey");
  assert.equal(
    releaseCommand.command,
    "./scripts/matchup-predictor-release sandbox --release-id <release-id> --artifact-prefix <absolute-artifact-stem>",
  );
});

test("sandbox predictor release command preserves an explicit identifier override", () => {
  const releaseCommand = buildSandboxPredictorReleaseCommand(
    ["sandbox", "--identifier", "Karey Local"],
    {
      userName: () => "ignored",
    },
  );

  assert.equal(releaseCommand.environmentName, "sandbox-karey-local");
  assert.equal(releaseCommand.sandboxIdentifier, "karey-local");
  assert.equal(
    releaseCommand.command,
    "./scripts/matchup-predictor-release sandbox --identifier karey-local --release-id <release-id> --artifact-prefix <absolute-artifact-stem>",
  );
});

test("sandbox predictor readiness fails with an exact remediation command when the SSM contract is missing", () => {
  assert.throws(
    () =>
      assertSandboxPredictorReady(["sandbox"], {
        env: {},
        execAwsJson: () => ({
          Parameters: [],
        }),
        userName: () => "karey",
      }),
    /From .* run: \.\/scripts\/matchup-predictor-release sandbox --release-id <release-id> --artifact-prefix <absolute-artifact-stem>/,
  );
});

test("sandbox predictor readiness fails when the endpoint is not in service", () => {
  assert.throws(
    () =>
      assertSandboxPredictorReady(["sandbox"], {
        env: {},
        execAwsJson: (args) => {
          if (args[0] === "ssm") {
            return {
              Parameters: [
                {
                  Name: "/buzzerbeater/ml-data-infra/sandbox-karey/prediction-endpoint-name",
                  Value: "buzzerbeater-machine-learning-predictor-sandbox-karey",
                },
              ],
            };
          }

          return {
            EndpointStatus: "Creating",
          };
        },
        userName: () => "karey",
      }),
    /Current status: Creating\./,
  );
});

test("sandbox predictor readiness returns endpoint metadata when the endpoint is in service", () => {
  const result = assertSandboxPredictorReady(["sandbox"], {
    env: {
      AWS_REGION: "us-east-1",
    },
    execAwsJson: (args) => {
      if (args[0] === "ssm") {
        return {
          Parameters: [
            {
              Name: "/buzzerbeater/ml-data-infra/sandbox-karey/prediction-endpoint-name",
              Value: "buzzerbeater-machine-learning-predictor-sandbox-karey",
            },
          ],
        };
      }

      return {
        EndpointStatus: "InService",
      };
    },
    userName: () => "karey",
  });

  assert.deepEqual(result, {
    endpointName: "buzzerbeater-machine-learning-predictor-sandbox-karey",
    environmentName: "sandbox-karey",
    region: "us-east-1",
    sandboxIdentifier: "karey",
  });
});
