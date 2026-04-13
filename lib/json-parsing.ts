import { z } from "zod";

export const jsonRecordSchema = z.record(z.unknown());

export function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseLegacyJsonField<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> | null {
  if (value == null) {
    return null;
  }

  const raw =
    typeof value === "string"
      ? value.trim()
        ? safeJsonParse(value)
        : null
      : value;
  if (raw == null) {
    return null;
  }

  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function readStoredValue<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> | null {
  return parseLegacyJsonField(schema, value);
}

export function parseJsonBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  body: string | null | undefined,
  fallback: unknown = {},
): z.infer<TSchema> {
  const raw = typeof body === "string" && body.trim() ? JSON.parse(body) : fallback;
  return schema.parse(raw);
}
