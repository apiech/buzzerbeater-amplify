export function encodeGraphqlJsonInput(value: unknown): string {
  return JSON.stringify(value);
}

export function decodeGraphqlJsonPayload<T>(payload: unknown): T {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as T;
    } catch {
      return {} as T;
    }
  }

  return (payload ?? {}) as T;
}
