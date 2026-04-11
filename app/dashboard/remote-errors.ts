export const COMMERCIAL_MODE_DISABLED_SENTINEL = "__commercial-mode-disabled__";

export function formatAmplifyErrors(
  errors: Array<{ message?: string }> | null | undefined,
): string {
  if (!errors?.length) {
    return "The operation failed without a detailed error message.";
  }

  return errors
    .map((error) => error.message?.trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
}

export function formatClientError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
