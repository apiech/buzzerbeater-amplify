import assert from "node:assert/strict";
import test from "node:test";

import { projectRoot, workspaceRoot } from "../scripts/deploy-runtime.ts";
import { __testing as workflowTesting } from "../scripts/deploy-workflow.ts";

test("sandbox secret sync sets the secret when it is missing", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];

  workflowTesting.runSandboxSecretSync([], createRuntime({
    env: {
      BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
    },
    spawnSync(command, args, options) {
      calls.push({ args, command, options });
      if (args.includes("list")) {
        return {
          status: 0,
          stderr: "",
          stdout:
            "No sandbox secrets found. To create a secret use sandbox secret set <secret-name>.\n",
        };
      }

      return {
        status: 0,
        stderr: "",
        stdout: "",
      };
    },
  }));

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.args.slice(0, 5), [
    "ampx",
    "sandbox",
    "secret",
    "list",
    "--identifier",
  ]);
  assert.deepEqual(calls[1]?.args.slice(0, 5), [
    "ampx",
    "sandbox",
    "secret",
    "set",
    "BB_CONNECTION_ENCRYPTION_SECRET",
  ]);
  assert.equal(calls[1].options?.input, "shared-secret\n");
});

test("sandbox secret sync skips writes when the secret already exists", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];

  workflowTesting.runSandboxSecretSync([], createRuntime({
    env: {
      BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
    },
    spawnSync(command, args, options) {
      calls.push({ args, command, options });
      return {
        status: 0,
        stderr: "",
        stdout: "BB_CONNECTION_ENCRYPTION_SECRET\n",
      };
    },
  }));

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.args.slice(0, 5), [
    "ampx",
    "sandbox",
    "secret",
    "list",
    "--identifier",
  ]);
});

test("sandbox doctor reports missing predictor infrastructure with the wrapper remediation", () => {
  const report = workflowTesting.collectSandboxDoctorReport(
    [],
    createRuntime({
      env: {
        APP_BASE_URL: "http://localhost:3000",
        AWS_REGION: "us-east-1",
        BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
        GAME_DAY_RECAP_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        STRIPE_PREMIUM_PRICE_ID: "price_sandbox_placeholder",
      },
      execAwsJson(args) {
        if (args[0] === "sts") {
          return {
            Account: "427377913956",
          };
        }
        if (args[0] === "ssm" && args.includes("prediction-endpoint-name")) {
          return {
            Parameters: [],
          };
        }

        return {
          InvalidParameters: [
            "/buzzerbeater/ml-data-infra/sandbox-karey/prediction-endpoint-name",
          ],
        };
      },
      spawnSync(_command, args) {
        if (args.includes("list")) {
          return {
            status: 0,
            stderr: "",
            stdout: "BB_CONNECTION_ENCRYPTION_SECRET\n",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${args.join(" ")}`);
      },
    }),
  );

  const predictorCheck = report.checks.find(
    (check) => check.label === "Predictor endpoint",
  );
  assert.ok(predictorCheck);
  assert.equal(predictorCheck.status, "fail");
  assert.match(
    predictorCheck.remediation,
    /\.\/scripts\/deploy sandbox-karey/,
  );

  const pinCheck = report.checks.find((check) => check.label === "Predictor pin");
  assert.ok(pinCheck);
  assert.equal(pinCheck.status, "warn");
  assert.match(pinCheck.remediation, /\.\/scripts\/deploy sandbox-karey/);
});

test("sandbox up runs deploy verification, secret sync, ML data infra, pinned predictor, then the sandbox process", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];
  const predictorTargetsPath =
    `${workspaceRoot}/bb-machine-learning/dist/matchup-predictor/targets.local.json`;
  const artifactPrefix =
    `${workspaceRoot}/bb-machine-learning/dist/matchup-predictor/ratings_universal_xgb_all`;

  const exitCode = workflowTesting.runSandboxUp(
    [],
    createRuntime({
      env: {
        BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
      },
      execAwsJson(args) {
        if (args[0] === "ssm") {
          return {
            Parameters: [],
          };
        }

        throw new Error(`Unexpected AWS CLI call: ${args.join(" ")}`);
      },
      fileExists(path) {
        return (
          path === predictorTargetsPath ||
          path === `${artifactPrefix}_model.ubj` ||
          path === `${artifactPrefix}_config.json`
        );
      },
      readFile(path) {
        if (path !== predictorTargetsPath) {
          throw new Error(`Unexpected file read: ${path}`);
        }

        return JSON.stringify({
          sandboxes: {
            karey: {
              artifactPrefix,
              releaseId: "ratings-universal-xgb-2026-03-19",
              updatedAt: "2026-03-19T12:00:00.000Z",
            },
          },
        });
      },
      spawnSync(command, args, options) {
        calls.push({ args, command, options });

        if (command === "npm" && args[0] === "run" && args[1] === "verify:deploy") {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }
        if (args.includes("list")) {
          return {
            status: 0,
            stderr: "",
            stdout: "BB_CONNECTION_ENCRYPTION_SECRET\n",
          };
        }
        if (command === "npm" && args.includes("deploy:ml-data-infra")) {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }
        if (command === "./scripts/matchup-predictor-release") {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }
        if (command === process.execPath) {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    }),
  );

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].command, "npm");
  assert.deepEqual(calls[0].args, ["run", "verify:deploy"]);
  assert.deepEqual(calls[1]?.args.slice(0, 4), [
    "ampx",
    "sandbox",
    "secret",
    "list",
  ]);
  assert.equal(calls[2].command, "npm");
  assert.match(calls[2].args.join(" "), /deploy:ml-data-infra/);
  const sandboxDataEnv = calls[2].options?.env as Record<string, string> | undefined;
  assert.match(
    sandboxDataEnv?.DOCKER_CONFIG ?? "",
    /bb-machine-learning\/dist\/.docker-cli$/,
  );
  assert.equal(calls[3].command, "./scripts/matchup-predictor-release");
  assert.deepEqual(calls[3].args, [
    "sandbox",
    "--identifier",
    "karey",
    "--use-pin",
    "sandbox",
  ]);
  assert.equal(calls[4].command, process.execPath);
  assert.deepEqual(calls[4].args.slice(1), ["sandbox", "--identifier", "karey"]);
  const sandboxEnv = calls[4].options?.env as Record<string, string> | undefined;
  assert.ok(sandboxEnv);
  assert.equal(
    sandboxEnv.BB_SKIP_SANDBOX_SHARED_INFRA_BOOTSTRAP,
    "1",
  );
  assert.equal(sandboxEnv.BB_SHARED_ENVIRONMENT_NAME, "sandbox-karey");
  assert.match(
    sandboxEnv.DOCKER_CONFIG,
    /bb-machine-learning\/dist\/.docker-cli$/,
  );
});

test("sandbox up forwards raw sandbox flags to the underlying sandbox process", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];

  const exitCode = workflowTesting.runSandboxUp(
    ["--once"],
    createRuntime({
      env: {
        BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
      },
      execAwsJson(args) {
        if (args[0] === "ssm") {
          return {
            Parameters: [
              {
                Name: "/buzzerbeater/ml-data-infra/sandbox-karey/prediction-endpoint-name",
                Value: "predictor-endpoint",
              },
            ],
          };
        }

        if (args[0] === "sagemaker") {
          return {
            EndpointStatus: "InService",
          };
        }

        throw new Error(`Unexpected AWS CLI call: ${args.join(" ")}`);
      },
      spawnSync(command, args, options) {
        calls.push({ args, command, options });

        if (command === "npm" && args[0] === "run" && args[1] === "verify:deploy") {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }
        if (args.includes("list")) {
          return {
            status: 0,
            stderr: "",
            stdout: "BB_CONNECTION_ENCRYPTION_SECRET\n",
          };
        }

        if (command === "npm" && args.includes("deploy:ml-data-infra")) {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }

        if (command === process.execPath) {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    }),
  );

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].command, "npm");
  assert.deepEqual(calls[0].args, ["run", "verify:deploy"]);
  assert.deepEqual(calls[3]?.args.slice(1), [
    "sandbox",
    "--identifier",
    "karey",
    "--once",
  ]);
});

test("sandbox up stops before side effects when deploy verification fails", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];

  assert.throws(
    () =>
      workflowTesting.runSandboxUp(
        [],
        createRuntime({
          env: {
            BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
          },
          spawnSync(command, args, options) {
            calls.push({ args, command, options });
            return {
              status:
                command === "npm" &&
                args[0] === "run" &&
                args[1] === "verify:deploy"
                  ? 1
                  : 0,
              stderr: "",
              stdout: "",
            };
          },
        }),
      ),
    /Deploy verification failed\./,
  );

  assert.deepEqual(calls, [
    {
      command: "npm",
      args: ["run", "verify:deploy"],
      options: {
        cwd: projectRoot,
        env: {
          BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
        },
        stdio: "inherit",
      },
    },
  ]);
});

test("sandbox up fails early when another sandbox process already holds the cdk.out lock", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];

  assert.throws(
    () =>
      workflowTesting.runSandboxUp(
        [],
        createRuntime({
          directoryExists(path) {
            return path === `${projectRoot}/.amplify/artifacts/cdk.out`;
          },
          env: {
            BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
          },
          listDir(path) {
            if (path !== `${projectRoot}/.amplify/artifacts/cdk.out`) {
              throw new Error(`Unexpected directory read: ${path}`);
            }

            return ["read.6845.1.lock"];
          },
          readFile(path) {
            if (path !== `${projectRoot}/.amplify/artifacts/cdk.out/read.6845.1.lock`) {
              throw new Error(`Unexpected file read: ${path}`);
            }

            return "6845\n";
          },
          spawnSync(command, args, options) {
            calls.push({ args, command, options });
            if (command === "ps") {
              return {
                status: 0,
                stderr: "",
                stdout:
                  "node /Users/karey/projects/bb/bb-amplify/node_modules/.bin/ampx sandbox --once --identifier karey\n",
              };
            }

            throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
          },
        }),
      ),
    /Another Amplify sandbox process is already running/,
  );

  assert.deepEqual(calls, [
    {
      command: "ps",
      args: ["-p", "6845", "-o", "command="],
      options: {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    },
  ]);
});

test("sandbox up removes stale sandbox lock files before continuing", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];
  const removedPaths: string[] = [];

  const exitCode = workflowTesting.runSandboxUp(
    ["--once"],
    createRuntime({
      directoryExists(path) {
        return path === `${projectRoot}/.amplify/artifacts/cdk.out`;
      },
      env: {
        BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
      },
      execAwsJson(args) {
        if (args[0] === "ssm") {
          return {
            Parameters: [
              {
                Name: "/buzzerbeater/ml-data-infra/sandbox-karey/prediction-endpoint-name",
                Value: "predictor-endpoint",
              },
            ],
          };
        }

        if (args[0] === "sagemaker") {
          return {
            EndpointStatus: "InService",
          };
        }

        throw new Error(`Unexpected AWS CLI call: ${args.join(" ")}`);
      },
      listDir(path) {
        if (path !== `${projectRoot}/.amplify/artifacts/cdk.out`) {
          throw new Error(`Unexpected directory read: ${path}`);
        }

        return ["manifest.json", "read.9999.1.lock"];
      },
      readFile(path) {
        if (path === `${projectRoot}/.amplify/artifacts/cdk.out/read.9999.1.lock`) {
          return "9999\n";
        }

        throw new Error(`Unexpected file read: ${path}`);
      },
      removeFile(path) {
        removedPaths.push(path);
      },
      spawnSync(command, args, options) {
        calls.push({ args, command, options });

        if (command === "ps") {
          return {
            status: 1,
            stderr: "",
            stdout: "",
          };
        }

        if (command === "npm" && args[0] === "run" && args[1] === "verify:deploy") {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }
        if (args.includes("list")) {
          return {
            status: 0,
            stderr: "",
            stdout: "BB_CONNECTION_ENCRYPTION_SECRET\n",
          };
        }

        if (command === "npm" && args.includes("deploy:ml-data-infra")) {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }

        if (command === process.execPath) {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    }),
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(removedPaths, [
    `${projectRoot}/.amplify/artifacts/cdk.out/read.9999.1.lock`,
  ]);
  assert.equal(calls[0].command, "ps");
  assert.deepEqual(calls[0].args, ["-p", "9999", "-o", "command="]);
  assert.deepEqual(calls.at(-1)?.args.slice(1), [
    "sandbox",
    "--identifier",
    "karey",
    "--once",
  ]);
});

test("dev prepare runs deploy verification before shared infra deploy side effects", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];

  const exitCode = workflowTesting.runDevPrepare(
    [],
    createRuntime({
      env: {
        AWS_REGION: "us-east-1",
        BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
      },
      execAwsJson(args) {
        if (args[0] === "sts") {
          return {
            Account: "427377913956",
          };
        }
        if (args[0] === "ssm") {
          return {
            InvalidParameters: [],
            Parameters: [
              {
                Name: "/buzzerbeater/ml-data-infra/dev/prediction-endpoint-name",
                Value: "predictor-endpoint",
              },
            ],
          };
        }
        if (args[0] === "sagemaker") {
          return {
            EndpointStatus: "InService",
          };
        }

        throw new Error(`Unexpected AWS CLI call: ${args.join(" ")}`);
      },
      spawnSync(command, args, options) {
        calls.push({ args, command, options });

        if (command === "npm" && args[0] === "run" && args[1] === "verify:deploy") {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }

        if (command === "npm" && args.includes("deploy:ml-data-infra")) {
          return {
            status: 0,
            stderr: "",
            stdout: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    }),
  );

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "npm");
  assert.deepEqual(calls[0].args, ["run", "verify:deploy"]);
  assert.equal(calls[1].command, "npm");
  assert.match(calls[1].args.join(" "), /deploy:ml-data-infra/);
  const devDataEnv = calls[1].options?.env as Record<string, string> | undefined;
  assert.match(
    devDataEnv?.DOCKER_CONFIG ?? "",
    /bb-machine-learning\/dist\/.docker-cli$/,
  );
});

test("sandbox opponent forecast deploy shells out through the workspace release wrapper", () => {
  const calls: Array<{
    args: string[];
    command: string;
    options?: Record<string, unknown>;
  }> = [];

  workflowTesting.runSandboxOpponentForecast(
    [
      "--release-id",
      "opponent-forecast-v1-2026-03-19",
      "--dataset-root",
      "/tmp/opponent-forecast-dataset",
    ],
    createRuntime({
      env: {},
      spawnSync(command, args, options) {
        calls.push({ args, command, options });
        return {
          status: 0,
          stderr: "",
          stdout: "",
        };
      },
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "./scripts/opponent-forecast-release");
  assert.deepEqual(calls[0].args, [
    "sandbox",
    "--identifier",
    "karey",
    "--release-id",
    "opponent-forecast-v1-2026-03-19",
    "--dataset-root",
    "/tmp/opponent-forecast-dataset",
  ]);
});

test("dev doctor warns when the optional opponent forecast endpoint contract is missing", () => {
  const report = workflowTesting.collectDevDoctorReport(
    createRuntime({
      env: {
        AWS_REGION: "us-east-1",
        BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
      },
      execAwsJson(args) {
        if (args[0] === "sts") {
          return {
            Account: "427377913956",
          };
        }
        if (args[0] === "ssm" && args.includes("prediction-endpoint-name")) {
          return {
            Parameters: [
              {
                Name: "/buzzerbeater/ml-data-infra/dev/prediction-endpoint-name",
                Value: "predictor-endpoint",
              },
            ],
          };
        }
        if (args[0] === "ssm") {
          return {
            InvalidParameters: [
              "/buzzerbeater/ml-data-infra/dev/opponent-forecast-endpoint-name",
            ],
          };
        }
        if (args[0] === "sagemaker") {
          return {
            EndpointStatus: "InService",
          };
        }

        throw new Error(`Unexpected AWS CLI call: ${args.join(" ")}`);
      },
      spawnSync(command, args, _options) {
        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    }),
  );

  const sharedInfraCheck = report.checks.find(
    (check) => check.label === "Shared infra SSM contract",
  );
  assert.ok(sharedInfraCheck);
  assert.equal(sharedInfraCheck.status, "warn");
  assert.match(
    sharedInfraCheck.remediation,
    /\.\/scripts\/deploy dev/,
  );
});

test("dev doctor points missing predictor pins at the root deploy wrapper", () => {
  const report = workflowTesting.collectDevDoctorReport(
    createRuntime({
      env: {
        AWS_REGION: "us-east-1",
        BB_CONNECTION_ENCRYPTION_SECRET: "shared-secret",
      },
      execAwsJson(args) {
        if (args[0] === "sts") {
          return {
            Account: "427377913956",
          };
        }
        if (args[0] === "ssm" && args.includes("prediction-endpoint-name")) {
          return {
            Parameters: [
              {
                Name: "/buzzerbeater/ml-data-infra/dev/prediction-endpoint-name",
                Value: "predictor-endpoint",
              },
            ],
          };
        }
        if (args[0] === "ssm") {
          return {
            InvalidParameters: [],
          };
        }
        if (args[0] === "sagemaker") {
          return {
            EndpointStatus: "InService",
          };
        }

        throw new Error(`Unexpected AWS CLI call: ${args.join(" ")}`);
      },
      spawnSync(command, args, _options) {
        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    }),
  );

  const pinCheck = report.checks.find((check) => check.label === "Predictor pin");
  assert.ok(pinCheck);
  assert.equal(pinCheck.status, "warn");
  assert.match(pinCheck.remediation, /\.\/scripts\/deploy dev/);
});

function createRuntime({
  directoryExists = () => false,
  env = {},
  execAwsJson,
  fileExists = () => false,
  listDir = () => [],
  readFile = () => "",
  removeFile = () => undefined,
  spawnSync,
}: {
  directoryExists?: (path: string) => boolean;
  env?: Record<string, string>;
  execAwsJson?: (args: string[]) => unknown;
  fileExists?: (path: string) => boolean;
  listDir?: (path: string) => string[];
  readFile?: (path: string) => string;
  removeFile?: (path: string) => void;
  spawnSync: (
    command: string,
    args: string[],
    options?: Record<string, unknown>,
  ) => {
    status: number | null;
    stderr?: string;
    stdout?: string;
  };
}) {
  return {
    directoryExists,
    env,
    execAwsJson:
      execAwsJson ??
      (() => {
        throw new Error("Unexpected AWS CLI call");
      }),
    fileExists,
    listDir,
    mkdirp() {
      return undefined;
    },
    nowIso() {
      return "2026-03-19T12:00:00.000Z";
    },
    readFile,
    removeFile,
    spawnSync,
    userName() {
      return "karey";
    },
    write() {
      return undefined;
    },
    writeError() {
      return undefined;
    },
    writeFile() {
      return undefined;
    },
  };
}
