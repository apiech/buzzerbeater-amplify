import {
  buildBbConnectionSecretParameterPaths,
} from "./shared-infra-contract.js";
import { resolveSharedEnvironmentName } from "./synth-env.js";

export const bbConnectionSecretParameterNameEnv =
  "BB_CONNECTION_ENCRYPTION_SECRET_PARAMETER_NAME";

export function resolveBbConnectionSecretParameterNameForSynth(
  env: Record<string, string | undefined> = process.env,
): string {
  return buildBbConnectionSecretParameterPaths(
    resolveSharedEnvironmentName(env),
  ).secret;
}

export function buildBbConnectionSecretFunctionEnvironment(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return {
    [bbConnectionSecretParameterNameEnv]:
      resolveBbConnectionSecretParameterNameForSynth(env),
  };
}
