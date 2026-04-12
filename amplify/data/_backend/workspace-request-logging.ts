const WORKSPACE_LOG_PREFIX = "[workspace]";

function writeWorkspaceLog(
  level: "INFO" | "WARN" | "ERROR",
  event: string,
  details: Record<string, unknown>,
): void {
  const line = `${WORKSPACE_LOG_PREFIX} ${JSON.stringify({
    details,
    event,
    level,
    loggedAt: new Date().toISOString(),
  })}\n`;
  if (level === "INFO") {
    process.stdout.write(line);
    return;
  }
  process.stderr.write(line);
}

export function logWorkspaceInfo(
  event: string,
  details: Record<string, unknown>,
): void {
  writeWorkspaceLog("INFO", event, details);
}

export function logWorkspaceWarn(
  event: string,
  details: Record<string, unknown>,
): void {
  writeWorkspaceLog("WARN", event, details);
}

export function logWorkspaceError(
  event: string,
  details: Record<string, unknown>,
): void {
  writeWorkspaceLog("ERROR", event, details);
}

export function elapsedMs(startedAtMs: number): number {
  return Date.now() - startedAtMs;
}

export function toLoggableError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {
      error: String(error),
    };
  }

  return {
    errorMessage: error.message,
    errorName: error.name,
    ...(error.stack ? { errorStack: error.stack } : {}),
  };
}
