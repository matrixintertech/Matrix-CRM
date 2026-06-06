export type ServerTimingMetric = {
  name: string;
  durationMs: number;
  description?: string;
};

function sanitizeToken(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export async function measureServerTiming<T>(name: string, work: () => Promise<T>, description?: string) {
  const startedAt = performance.now();
  const result = await work();

  return {
    result,
    metric: {
      name: sanitizeToken(name),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      description,
    } satisfies ServerTimingMetric,
  };
}

export function createServerTimingHeader(metrics: ServerTimingMetric[]) {
  return metrics
    .filter((metric) => Number.isFinite(metric.durationMs))
    .map((metric) => {
      const descriptionPart = metric.description ? `;desc="${metric.description.replace(/"/g, "")}"` : "";
      return `${sanitizeToken(metric.name)};dur=${metric.durationMs}${descriptionPart}`;
    })
    .join(", ");
}

export function withServerTimingHeaders(init: HeadersInit | undefined, metrics: ServerTimingMetric[]) {
  const headers = new Headers(init);
  const headerValue = createServerTimingHeader(metrics);

  if (headerValue) {
    headers.set("Server-Timing", headerValue);
  }

  return headers;
}
