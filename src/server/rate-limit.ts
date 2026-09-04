const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429, code: "FG_RATE_LIMITED" });
  }
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
