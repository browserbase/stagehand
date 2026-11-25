import type {
  Action,
  CacheMetadata,
  Caching,
  StagehandActParams,
  StagehandExtractParams,
  StagehandInitParams,
  StagehandObserveParams,
} from "@browserbasehq/stagehand-protocol/types";
import {
  CacheClient,
  type CacheGetResponse,
  type CacheLlmUsage,
  type CacheMethod,
  type CdpTree,
} from "../clients/cacheClient.js";
import type { ClientBrowserbaseRequest } from "../clients/browserbaseClient.js";
import type { StagehandLogger } from "../logger.js";
import type { Frame } from "../understudy/frame.js";
import { type Progress, runLocatorStep } from "../understudy/progress.js";

interface CachePage {
  url(): string;
  frames(): Frame[];
  mainFrame(): Frame;
}

export interface CacheContext {
  sessionId: string;
  client: CacheClient;
  defaultCaching: Caching;
}

export function buildCacheContext(
  initParams: StagehandInitParams,
  request?: ClientBrowserbaseRequest,
): CacheContext | undefined {
  const sessionId = initParams.browser?.sessionId;
  if (!sessionId || initParams.browserbase !== "client") return undefined;
  const client = new CacheClient({ request });
  return {
    sessionId,
    client,
    defaultCaching: initParams.cache ?? true,
  };
}

/**
 * The `data` payloads mirror the external API's v3 act/observe/extract
 * schemas — only the fields that participate in the cache key are sent
 * (withCache threads the caching threshold in separately). The v3 act cache
 * contract still calls its instruction `input`, so preserve that adapter key
 * until the external API migrates. Model configuration is deliberately
 * omitted: it is not part of the cache key and its v4 shape does not parse
 * under the v3 schema.
 */
export function buildActCacheData(params: StagehandActParams): Record<string, unknown> {
  return {
    input: params.instruction,
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
          screenshot: params.options.screenshot,
        }
      : undefined,
  };
}

export function shouldBypassCacheForLocatorScope(
  options:
    | StagehandActParams["options"]
    | StagehandObserveParams["options"]
    | StagehandExtractParams["options"],
): boolean {
  return Boolean(options?.locator || options?.ignoreLocators?.length);
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
  cacheValue?: unknown;
  llmUsage?: CacheLlmUsage;
}

function hitMetadata(response: CacheGetResponse): CacheMetadata {
  const { tokensSaved } = response;
  return {
    status: "HIT",
    ...(response.hitCount !== undefined && { count: response.hitCount }),
    ...(response.threshold !== undefined && { threshold: response.threshold }),
    ...(tokensSaved !== undefined && {
      tokensSaved: {
        inputTokens: tokensSaved.input,
        outputTokens: tokensSaved.output,
        totalTokens: tokensSaved.total,
      },
    }),
  };
}

function missMetadata(response: CacheGetResponse | null, reason?: string): CacheMetadata {
  return {
    status: "MISS",
    missReason: reason ?? response?.missReason ?? "unknown",
    ...(response?.hitCount !== undefined && { count: response.hitCount }),
    ...(response?.threshold !== undefined && { threshold: response.threshold }),
  };
}

export async function withCache<Result extends { metadata: { cache: CacheMetadata } }>({
  method,
  page,
  data,
  caching,
  bypass,
  context,
  logger,
  onHit,
  execute,
  progress,
}: {
  method: CacheMethod;
  progress?: Progress;
  page: unknown;
  data: Record<string, unknown>;
  caching?: Caching;
  bypass?: boolean;
  context: CacheContext | undefined;
  logger: StagehandLogger;
  onHit: (value: unknown) => Promise<Result> | Result;
  execute: () => Promise<CacheExecuteOutcome<Result>>;
}): Promise<Result> {
  progress?.throwIfStopped();
  const resolvedCaching = caching ?? context?.defaultCaching ?? true;
  const cachePage = resolvedCaching !== false ? asCachePage(page) : null;
  if (bypass || !context || !cachePage) {
    return (await execute()).result;
  }

  const cdpTree = await collectCdpTree(cachePage, logger, progress);
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
  let readFailureReason = "read_failed";
  try {
    getResponse = await runLocatorStep(progress, "reading cache", () =>
      context.client.get(baseRequest),
    );
  } catch (error) {
    progress?.throwIfStopped();
    readFailureReason =
      error instanceof Error && error.name === "TimeoutError" ? "timeout" : "read_failed";
    logger.warn("Cache read failed; executing without cache", {
      category: "cache",
      method,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let cacheMetadata: CacheMetadata;
  if (getResponse?.hit && getResponse.value !== undefined && getResponse.value !== null) {
    try {
      const result = await runLocatorStep(progress, "applying cached result", async () =>
        onHit(getResponse.value),
      );
      result.metadata.cache = hitMetadata(getResponse);
      logger.debug("Cache hit", {
        category: "cache",
        method,
        cacheKey: getResponse.cacheKey ?? "",
        hitCount: getResponse.hitCount ?? 0,
        ageMs: getResponse.ageMs ?? 0,
      });
      return result;
    } catch (error) {
      progress?.throwIfStopped();
      logger.warn("Cached value could not be applied; falling back to execution", {
        category: "cache",
        method,
        cacheKey: getResponse.cacheKey ?? "",
        error: error instanceof Error ? error.message : String(error),
      });
      cacheMetadata = missMetadata(getResponse, "replay_failed");
    }
  } else if (getResponse) {
    cacheMetadata = missMetadata(getResponse);
    logger.debug("Cache miss", {
      category: "cache",
      method,
      cacheKey: getResponse.cacheKey ?? "",
      missReason: cacheMetadata.missReason ?? "unknown",
    });
  } else {
    cacheMetadata = missMetadata(null, readFailureReason);
  }

  progress?.throwIfStopped();
  const outcome = await execute();
  progress?.throwIfStopped();
  outcome.result.metadata.cache = cacheMetadata;

  if (
    getResponse?.missReason !== "payload_too_large" &&
    outcome.cacheValue !== undefined &&
    outcome.cacheValue !== null
  ) {
    try {
      const setResponse = await runLocatorStep(progress, "writing cache", () =>
        context.client.set({
          ...baseRequest,
          value: outcome.cacheValue,
          llmUsage: outcome.llmUsage,
        }),
      );
      logger.debug(setResponse.written ? "Cache write completed" : "Cache write skipped", {
        category: "cache",
        method,
        cacheKey: setResponse.cacheKey ?? "",
        skippedReason: setResponse.skippedReason ?? "",
      });
    } catch (error) {
      progress?.throwIfStopped();
      logger.warn("Cache write failed", {
        category: "cache",
        method,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcome.result;
}

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

async function collectCdpTree(
  page: CachePage,
  logger: StagehandLogger,
  progress?: Progress,
): Promise<CdpTree | null> {
  try {
    const mainFrame = page.mainFrame();
    const frames: CdpTree["frames"] = [];
    for (const frame of page.frames()) {
      frames.push({
        frameId: frame.frameId,
        axNodes: await runLocatorStep(progress, "reading cache accessibility tree", () =>
          frame.getAccessibilityTree(progress),
        ),
      });
    }

    return {
      rootFrameId: mainFrame.frameId,
      frames,
    };
  } catch (error) {
    progress?.throwIfStopped();
    logger.warn("Failed to collect CDP tree for cache; executing without cache", {
      category: "cache",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
