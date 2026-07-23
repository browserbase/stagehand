import type { Protocol } from "devtools-protocol";
import type {
  Action,
  Caching,
  StagehandActParams,
  StagehandExtractParams,
  StagehandInitParams,
  StagehandObserveParams,
} from "../../protocol/types.js";
import {
  CacheClient,
  apiUrlForRegion,
  type CacheGetResponse,
  type CacheLlmUsage,
  type CacheMethod,
  type CdpTree,
} from "../clients/cacheClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Frame } from "../understudy/frame.js";
import { FrameSelectorResolver } from "../understudy/selectorResolver.js";

/**
 * Server-side caching for act/observe/extract via the Stagehand API's
 * stateless cache routes.
 *
 * The runtime owns the CDP connection, so it ships the raw accessibility
 * tree(s) plus the request params; the API server owns all cache-key
 * computation (DOM shaping/hashing, URL normalization), project gating, and
 * the Redis read/write. This service owns the caching decisions — when to
 * read, what to write, how to fall back — and talks to the API through
 * clients/cacheClient.ts.
 *
 * Everything here is best-effort: any cache failure falls back to normal
 * execution and must never break the action.
 */

type CacheStatus = "HIT" | "MISS";

/** The page surface the cache needs to assemble the raw CDP tree payload. */
interface CachePage {
  url(): string;
  frames(): Frame[];
  mainFrame(): Frame;
}

export interface CacheContext {
  sessionId: string;
  client: CacheClient;
  /** Instance-level default; each request can override via options.cache. */
  defaultCaching: Caching;
}

/**
 * Builds the per-instance cache context from init params. Returns undefined
 * when caching is impossible: the stateless routes authenticate with the
 * Browserbase API key and resolve the project from the session id, so both
 * are required.
 */
export function buildCacheContext(initParams: StagehandInitParams): CacheContext | undefined {
  const sessionId = initParams.browser?.sessionId;
  if (!initParams.apiKey || !sessionId) return undefined;
  return {
    sessionId,
    client: new CacheClient(apiUrlForRegion(initParams.browser?.region), initParams.apiKey),
    defaultCaching: initParams.cache ?? false,
  };
}

/**
 * The `data` payloads mirror the API's v3 act/observe/extract schemas — only
 * the fields that participate in the cache key are sent (withCache threads
 * the caching threshold in separately). Model configuration is deliberately
 * omitted: it is not part of the cache key and its v4 shape does not parse
 * under the v3 schema.
 */
export function buildActCacheData(params: StagehandActParams): Record<string, unknown> {
  return {
    input: params.input,
    options: params.options
      ? {
          variables: params.options.variables,
          timeout: params.options.timeout,
        }
      : undefined,
  };
}

export function buildObserveCacheData(params: StagehandObserveParams): Record<string, unknown> {
  return {
    instruction: params.instruction,
    options: params.options
      ? {
          variables: params.options.variables,
          timeout: params.options.timeout,
          selector: params.options.selector,
          ignoreSelectors: params.options.ignoreSelectors,
        }
      : undefined,
  };
}

export function buildExtractCacheData(params: StagehandExtractParams): Record<string, unknown> {
  return {
    instruction: params.instruction,
    schema: params.schema,
    options: params.options
      ? {
          timeout: params.options.timeout,
          selector: params.options.selector,
          ignoreSelectors: params.options.ignoreSelectors,
          screenshot: params.options.screenshot,
        }
      : undefined,
  };
}

/**
 * Cached act/observe values are Action arrays that round-tripped through
 * Redis cjson, which can mangle shapes (e.g. empty arrays become objects).
 * Rebuild well-formed Actions and drop anything unusable rather than letting
 * a malformed entry break replay.
 */
export function normalizeCachedActions(value: unknown): Action[] {
  if (!Array.isArray(value)) return [];
  const actions: Action[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.selector !== "string" || candidate.selector.length === 0) continue;
    actions.push({
      selector: candidate.selector,
      description: typeof candidate.description === "string" ? candidate.description : "",
      method: typeof candidate.method === "string" ? candidate.method : undefined,
      arguments: Array.isArray(candidate.arguments)
        ? candidate.arguments.filter((arg): arg is string => typeof arg === "string")
        : [],
    });
  }
  return actions;
}

export interface CacheExecuteOutcome<Result> {
  result: Result;
  /** What to persist on a miss; undefined/null skips the cache write. */
  cacheValue?: unknown;
  llmUsage?: CacheLlmUsage;
}

/**
 * Shared cache intercept for the act/observe/extract services.
 *
 * Collects the raw CDP accessibility tree(s), asks the API for a cached
 * value, and on a hit maps it back to a service result via `onHit` (observe/
 * extract return it directly; act replays the cached actions). On a miss —
 * or whenever any cache step fails, including `onHit` itself — falls back to
 * `execute` and then persists the outcome's `cacheValue`.
 */
export async function withCache<Result extends { cacheStatus?: CacheStatus }>({
  method,
  page,
  data,
  selector,
  caching,
  context,
  logger,
  onHit,
  execute,
}: {
  method: CacheMethod;
  page: unknown;
  data: Record<string, unknown>;
  /** Focus selector (observe/extract); resolved to a backendNodeId so the
   * server scopes the DOM hash exactly like the live v3 routes. */
  selector?: string;
  /** Per-request override from options.cache. */
  caching?: Caching;
  context: CacheContext | undefined;
  logger: StagehandLogger;
  onHit: (value: unknown) => Promise<Result> | Result;
  execute: () => Promise<CacheExecuteOutcome<Result>>;
}): Promise<Result> {
  const resolvedCaching = caching ?? context?.defaultCaching ?? false;
  const cachePage = resolvedCaching !== false ? asCachePage(page) : null;
  if (!context || !cachePage) {
    return (await execute()).result;
  }

  const cdpTree = await collectCdpTree(cachePage, selector, logger);
  if (!cdpTree) {
    return (await execute()).result;
  }

  const baseRequest = {
    method,
    sessionId: context.sessionId,
    url: cachePage.url(),
    cdpTree,
    data: withCacheThreshold(data, resolvedCaching),
  };

  let getResponse: CacheGetResponse | null = null;
  try {
    getResponse = await context.client.get(baseRequest);
  } catch (error) {
    logger.warn("Cache read failed; executing without cache", {
      category: "cache",
      method,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (getResponse?.hit && getResponse.value !== undefined && getResponse.value !== null) {
    try {
      const result = await onHit(getResponse.value);
      result.cacheStatus = "HIT";
      logger.info("Cache hit", {
        category: "cache",
        method,
        cacheKey: getResponse.cacheKey ?? "",
        hitCount: getResponse.hitCount ?? 0,
        ageMs: getResponse.ageMs ?? 0,
      });
      return result;
    } catch (error) {
      logger.warn("Cached value could not be applied; falling back to execution", {
        category: "cache",
        method,
        cacheKey: getResponse.cacheKey ?? "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (getResponse) {
    logger.info("Cache miss", {
      category: "cache",
      method,
      cacheKey: getResponse.cacheKey ?? "",
      missReason: getResponse.missReason ?? "unknown",
    });
  }

  const outcome = await execute();
  outcome.result.cacheStatus = "MISS";

  if (outcome.cacheValue !== undefined && outcome.cacheValue !== null) {
    try {
      const setResponse = await context.client.set({
        ...baseRequest,
        value: outcome.cacheValue,
        llmUsage: outcome.llmUsage,
      });
      logger.info(setResponse.written ? "Cache write completed" : "Cache write skipped", {
        category: "cache",
        method,
        cacheKey: setResponse.cacheKey ?? "",
        skippedReason: setResponse.skippedReason ?? "",
      });
    } catch (error) {
      logger.warn("Cache write failed", {
        category: "cache",
        method,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcome.result;
}

/**
 * Threads the caller's threshold into the wire payload as
 * data.options.cacheThreshold — the field the API's stateless routes
 * read to override the project's hit-count threshold on both get and set.
 */
function withCacheThreshold(
  data: Record<string, unknown>,
  caching: Caching,
): Record<string, unknown> {
  const threshold = typeof caching === "object" ? caching.threshold : undefined;
  if (threshold === undefined) return data;
  const options = (data.options as Record<string, unknown> | undefined) ?? {};
  return { ...data, options: { ...options, cacheThreshold: threshold } };
}

function asCachePage(page: unknown): CachePage | null {
  const candidate = page as Partial<CachePage> | null | undefined;
  if (
    candidate &&
    typeof candidate.url === "function" &&
    typeof candidate.frames === "function" &&
    typeof candidate.mainFrame === "function"
  ) {
    return candidate as CachePage;
  }
  return null;
}

/**
 * Collects the verbatim Accessibility.getFullAXTree nodes for every frame,
 * plus the resolved backendNodeId for the focus selector when one is set —
 * the server requires it to scope the DOM hash to the selector's subtree.
 * Returns null (skip caching) when the payload can't be assembled.
 */
async function collectCdpTree(
  page: CachePage,
  selector: string | undefined,
  logger: StagehandLogger,
): Promise<CdpTree | null> {
  try {
    const mainFrame = page.mainFrame();
    const frames: CdpTree["frames"] = [];
    for (const frame of page.frames()) {
      frames.push({
        frameId: frame.frameId,
        axNodes: await frame.getAccessibilityTree(false),
      });
    }

    let focusBackendNodeId: number | undefined;
    if (selector) {
      focusBackendNodeId = await resolveBackendNodeId(mainFrame, selector);
      if (focusBackendNodeId === undefined) {
        logger.info("Cache skipped: focus selector did not resolve to a node", {
          category: "cache",
          selector,
        });
        return null;
      }
    }

    return {
      rootFrameId: mainFrame.frameId,
      frames,
      ...(focusBackendNodeId !== undefined && { focusBackendNodeId }),
    };
  } catch (error) {
    logger.warn("Failed to collect CDP tree for cache; executing without cache", {
      category: "cache",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolveBackendNodeId(frame: Frame, selector: string): Promise<number | undefined> {
  const resolver = new FrameSelectorResolver(frame);
  const resolved = await resolver.resolveFirst(FrameSelectorResolver.parseSelector(selector));
  if (!resolved) return undefined;

  const { node } = await frame.session.send<{ node: Protocol.DOM.Node }>("DOM.describeNode", {
    objectId: resolved.objectId,
  });
  return node.backendNodeId;
}
