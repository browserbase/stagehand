import type { Protocol } from "devtools-protocol";
import { z } from "zod/v4";
import type { ClientBrowserbaseRequest } from "./browserbaseClient.js";

const CACHE_REQUEST_TIMEOUT_MS = 5_000;

const CACHE_REQUEST_MAX_BYTES = 25_000_000;

const AXNodeSchema = z.custom<Protocol.Accessibility.AXNode>(
  (value) => typeof value === "object" && value !== null,
);

export const CdpTreeSchema = z.object({
  rootFrameId: z.string(),
  frames: z.array(
    z.object({
      frameId: z.string(),
      axNodes: z.array(AXNodeSchema),
    }),
  ),
  focusBackendNodeId: z.number().optional(),
});

export const CacheMethodSchema = z.enum(["act", "observe", "extract"]);

export const CacheLlmUsageSchema = z.object({
  model: z.string().optional(),
  dollars: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  llmDurationMs: z.number().optional(),
  savedDurationMs: z.number().optional(),
});

const CacheRequestBaseSchema = z.object({
  method: CacheMethodSchema,
  sessionId: z.string().min(1),
  url: z.string().min(1),
  cdpTree: CdpTreeSchema,
  data: z.record(z.string(), z.unknown()),
});

export const CacheGetRequestSchema = CacheRequestBaseSchema;

export const CacheSetRequestSchema = CacheRequestBaseSchema.extend({
  value: z.unknown(),
  llmUsage: CacheLlmUsageSchema.optional(),
});

export const CacheGetResponseSchema = z.object({
  cacheKey: z.string().nullable(),
  hit: z.boolean(),
  value: z.unknown().optional(),
  missReason: z.string().optional(),
  threshold: z.number().optional(),
  hitCount: z.number().optional(),
  ageMs: z.number().optional(),
  tokensSaved: z
    .object({
      input: z.number(),
      output: z.number(),
      total: z.number(),
    })
    .optional(),
});

export const CacheSetResponseSchema = z.object({
  cacheKey: z.string().nullable(),
  written: z.boolean(),
  skippedReason: z.string().optional(),
});

const ApiResponseEnvelopeSchema = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), data: z.unknown().optional() }),
  z.object({ success: z.literal(false), message: z.string().optional() }),
]);

export type CacheMethod = z.infer<typeof CacheMethodSchema>;
export type CdpTree = z.infer<typeof CdpTreeSchema>;
export type CacheLlmUsage = z.infer<typeof CacheLlmUsageSchema>;
export type CacheGetRequest = z.infer<typeof CacheGetRequestSchema>;
export type CacheSetRequest = z.infer<typeof CacheSetRequestSchema>;
export type CacheGetResponse = z.infer<typeof CacheGetResponseSchema>;
export type CacheSetResponse = z.infer<typeof CacheSetResponseSchema>;

type CacheTransport = { request?: ClientBrowserbaseRequest };

export class CacheClient {
  constructor(readonly transport: CacheTransport) {}

  async get(request: CacheGetRequest): Promise<CacheGetResponse> {
    return await this.post("/cache/get", request, CacheGetResponseSchema);
  }

  async set(request: CacheSetRequest): Promise<CacheSetResponse> {
    return await this.post("/cache/set", request, CacheSetResponseSchema);
  }

  private async post<Schema extends z.ZodType>(
    path: "/cache/get" | "/cache/set",
    request: CacheGetRequest | CacheSetRequest,
    responseSchema: Schema,
  ): Promise<z.infer<Schema>> {
    const deadline = performance.now() + CACHE_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = () =>
      controller.abort(new DOMException("Cache request timed out", "TimeoutError"));
    const timer = setTimeout(timeout, CACHE_REQUEST_TIMEOUT_MS);
    try {
      const body = JSON.stringify(request);
      if (utf8ByteLengthExceeds(body, CACHE_REQUEST_MAX_BYTES)) {
        return responseSchema.parse(
          path === "/cache/get"
            ? { cacheKey: null, hit: false, missReason: "payload_too_large" }
            : { cacheKey: null, written: false, skippedReason: "payload_too_large" },
        );
      }
      const remainingTimeoutMs = Math.max(0, deadline - performance.now());
      if (remainingTimeoutMs === 0) timeout();
      controller.signal.throwIfAborted();
      if (!this.transport.request) throw new Error("Client Browserbase transport is unavailable");
      const response = await this.transport.request(
        {
          operation: path === "/cache/get" ? "cache.get" : "cache.set",
          headers: { "content-type": "application/json" },
          body,
          remainingTimeoutMs,
        },
        controller.signal,
      );

      if (!response.ok) {
        throw new Error(`Cache request ${path} failed with status ${response.status}`);
      }

      const envelope = ApiResponseEnvelopeSchema.safeParse(await response.json());
      if (!envelope.success) {
        throw new Error(`Cache request ${path} returned an unrecognized envelope`);
      }
      if (!envelope.data.success) {
        throw new Error(
          `Cache request ${path} rejected: ${envelope.data.message ?? "unknown error"}`,
        );
      }

      const parsed = responseSchema.safeParse(envelope.data.data);
      if (!parsed.success) {
        throw new Error(
          `Cache request ${path} returned an unexpected payload: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  }
}

function utf8ByteLengthExceeds(value: string, limit: number): boolean {
  if (value.length > limit) return true;
  let byteLength = 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      // BMP characters and lone surrogates both encode to three bytes.
      byteLength += 3;
    }
    if (byteLength > limit) return true;
  }
  return false;
}
