const SENSITIVE_KEYS = /password|token|secret|credential|authorization/i;

export function logJson(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(redact(entry)));
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(inner)]),
  );
}
