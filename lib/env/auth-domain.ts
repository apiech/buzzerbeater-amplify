export * from "../../amplify/_shared/auth-domain";

export function readAuthDomainRuntimeEnv(): Record<string, string | undefined> {
  try {
    return ((process as NodeJS.Process | undefined)?.["env"] ?? {}) as Record<
      string,
      string | undefined
    >;
  } catch {
    return {};
  }
}
