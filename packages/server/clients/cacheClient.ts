import type { Protocol } from "devtools-protocol";
import { z } from "zod/v4";
import type { BrowserbaseRegion } from "../../protocol/types.js";

/**
 * HTTP client for the Stagehand API's stateless cache routes (POST /cache/get
 * and POST /cache/set). Owns transport concerns only: endpoint resolution,
 * auth headers, timeouts, and schema validation of requests going out and
 * responses coming back. All caching decisions (when to read, what to write,
 * fallback behavior) live in services/cacheService.ts, this client's only
 * consumer. See stagehand-api-v3's lib/cache/statelessCache.ts for the
 * server-side contract.
 */

/** Stagehand API base URL per Browserbase region; sessions must hit the API
 * deployment in the region their browser runs in. Mirrors the v3 SDK's
 * REGION_API_URLS. */
const REGION_API_URLS: Record<BrowserbaseRegion, string> = {
  "us-west-2": "https://api.stagehand.browserbase.com",
  "us-east-1": "https://api.use1.stagehand.browserbase.com",
  "eu-central-1": "https://api.euc1.stagehand.browserbase.com",
  "ap-southeast-1": "https://api.apse1.stagehand.browserbase.com",
};

const DEFAULT_REGION: BrowserbaseRegion = "us-west-2";

export function apiUrlForRegion(region: BrowserbaseRegion | undefined): string {
  return `${REGION_API_URLS[region ?? DEFAULT_REGION]}/v1`;
}

/** Ceiling for a single cache HTTP round-trip so a slow cache can only ever
 * add a bounded delay to the action it fronts. */
const CACHE_REQUEST_TIMEOUT_MS = 5_000;

// One raw CDP accessibility node from Accessibility.getFullAXTree, passed
// through verbatim — the server reproduces the v3 tree shaping over the raw
// nodes, so the client only checks that it is an object.
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

/** LLM usage hints sent on /cache/set, used server-side to emit cache savings
 * metrics on future hits. Mirrors the API's llmUsageSchema. */
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
  /** Method params shaped like the API's v3 act/observe/extract schemas. */
  data: z.record(z.string(), z.unknown()),
});

export const CacheGetRequestSchema = CacheRequestBaseSchema;

export const CacheSetRequestSchema = CacheRequestBaseSchema.extend({
  value: z.unknown(),
  llmUsage: CacheLlmUsageSchema.optional(),
});

export const CacheGetResponseSchema = z.object({
  /** Null only when the server could not build a key (empty tree / bad URL). */
  cacheKey: z.string().nullable(),
  hit: z.boolean(),
  /** Present only on a hit. */
  value: z.unknown().optional(),
  /** Present on a miss; explains why the cache was not served. */
  missReason: z.string().optional(),
  /** Present on a hit, and on a threshold miss. */
  threshold: z.number().optional(),
  /** Present on a hit, and on a threshold miss: times this key has been seen. */
  hitCount: z.number().optional(),
  /** Present on a hit: age of the cached entry in ms. */
  ageMs: z.number().optional(),
});

export const CacheSetResponseSchema = z.object({
  /** Null only when the server could not build a key. */
  cacheKey: z.string().nullable(),
  /** True when the write was issued to Redis. */
  written: z.boolean(),
  /** Present when the write was skipped; explains why. */
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

export class CacheClient {
  constructor(
    readonly apiUrl: string,
    readonly apiKey: string,
  ) {}

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
    const response = await fetch(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bb-api-key": this.apiKey,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(CACHE_REQUEST_TIMEOUT_MS),
    });

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
  }
}
