type Metric = { count: number; totalMs: number; failures: number };

const metrics = new Map<string, Metric>();

export function recordMetric(name: string, durationMs: number, failed = false): void {
  const current = metrics.get(name) ?? { count: 0, totalMs: 0, failures: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  if (failed) current.failures += 1;
  metrics.set(name, current);
}

export function metricsSnapshot() {
  return [...metrics.entries()].map(([name, metric]) => ({
    name,
    count: metric.count,
    avgLatencyMs: metric.count === 0 ? 0 : Math.round(metric.totalMs / metric.count),
    failures: metric.failures,
  }));
}

export function metricsText(): string {
  return metricsSnapshot()
    .map((metric) => `${metric.name}_count ${metric.count}\n${metric.name}_avg_latency_ms ${metric.avgLatencyMs}\n${metric.name}_failure_total ${metric.failures}`)
    .join("\n");
}

export function resetMetricsForTests(): void {
  metrics.clear();
}
