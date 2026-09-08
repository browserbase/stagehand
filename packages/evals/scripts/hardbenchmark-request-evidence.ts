import { createHash } from "node:crypto";

export interface VerifierRequestEvidence {
  schema: string;
  body: Record<string, unknown>;
  captureVersion?: 1;
  endpoint?: string;
  method?: string;
  bodyHash?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requestSchema(body: Record<string, unknown>): string {
  const schemas = [
    record(record(body.text)?.format)?.schema,
    record(record(body.response_format)?.json_schema)?.schema,
    record(body.generationConfig)?.responseSchema,
    record(body.generationConfig)?.responseJsonSchema,
    record(record(body.output_config)?.format)?.schema,
    ...(Array.isArray(body.tools) ? body.tools.map((tool) => record(tool)?.input_schema) : []),
  ];
  for (const schema of schemas) {
    const properties = record(record(schema)?.properties);
    if (properties?.per_criterion) return "FusedJudgment";
    const itemProperties = record(record(record(properties?.items)?.items)?.properties);
    if (itemProperties?.evidence_idx && itemProperties?.scores) return "BatchedRelevance";
  }
  throw new Error("Unexpected live verifier schema; rubric generation is not permitted");
}

function allowedEndpoint(provider: string, url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  switch (provider) {
    case "google":
      return (
        url.hostname === "generativelanguage.googleapis.com" &&
        /^\/v1(?:beta)?\/models\/[^/]+:generateContent$/.test(url.pathname)
      );
    case "openai":
      return (
        url.hostname === "api.openai.com" &&
        ["/v1/responses", "/v1/chat/completions"].includes(url.pathname)
      );
    case "anthropic":
      return url.hostname === "api.anthropic.com" && url.pathname === "/v1/messages";
    default:
      return false;
  }
}

function sanitizeBody(value: unknown, redactValues: readonly string[]): unknown {
  if (typeof value === "string") {
    let sanitized = value;
    for (const secret of redactValues) {
      if (secret) sanitized = sanitized.split(secret).join("[redacted]");
    }
    return sanitized;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeBody(item, redactValues));
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      /^(authorization|proxy.authorization|api.?key|x.goog.api.key|password|secret|access.?token|refresh.?token|credentials?)$/i.test(
        key,
      )
        ? "[redacted]"
        : sanitizeBody(item, redactValues),
    ]),
  );
}

/** Record only sanitized JSON and an endpoint without query parameters; never request headers. */
export function createLiveVerifierFetch({
  provider,
  fetchImpl,
  onRequest,
  redactValues = [],
}: {
  provider: string;
  fetchImpl: typeof fetch;
  onRequest: (request: VerifierRequestEvidence) => Promise<void> | void;
  redactValues?: readonly string[];
}): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== "POST" || !allowedEndpoint(provider, url)) {
      throw new Error("Unexpected live verifier endpoint or method");
    }
    let body: Record<string, unknown> | undefined;
    try {
      body = record(await request.clone().json());
    } catch {
      throw new Error("Live verifier request must contain a JSON object");
    }
    if (!body) throw new Error("Live verifier request must contain a JSON object");
    const schema = requestSchema(body);
    const sanitized = sanitizeBody(body, redactValues) as Record<string, unknown>;
    await onRequest({
      captureVersion: 1,
      endpoint: `${url.origin}${url.pathname}`,
      method: request.method,
      schema,
      body: sanitized,
      bodyHash: createHash("sha256").update(JSON.stringify(sanitized)).digest("hex"),
    });
    // Forward the original request: capture must not modify prompts, auth, body or abort signal.
    return fetchImpl(request);
  };
}
