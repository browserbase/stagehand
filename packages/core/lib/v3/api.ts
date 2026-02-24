import makeFetchCookie from "fetch-cookie";
import { loadApiKeyFromEnv } from "../utils.js";
import { STAGEHAND_VERSION } from "../version.js";
import {
  StagehandAPIError,
  StagehandAPIUnauthorizedError,
  StagehandHttpError,
  StagehandResponseBodyError,
  StagehandResponseParseError,
  StagehandServerError,
  ExperimentalNotConfiguredError,
} from "./types/public/index.js";
import type {
  ActResult,
  AgentConfig,
  AgentExecuteOptions,
  AgentResult,
  ExtractResult,
  ObserveResult,
  LogLine,
  StagehandMetrics,
  BrowserbaseRegion,
  ActOptions,
  ExtractOptions,
  ObserveOptions,
  Api,
} from "./types/public/index.js";
import type {
  SerializableResponse,
  AgentCacheTransferPayload,
} from "./types/private/index.js";
import type { ModelConfiguration } from "./types/public/model.js";
import { toJsonSchema } from "./zodCompat.js";
import type { StagehandZodSchema } from "./zodCompat.js";

// =============================================================================
// Multi-region API URL mapping
// =============================================================================

/**
 * Mapping of Browserbase regions to their corresponding Stagehand API base URLs.
 * Users should configure their client to hit the API endpoint that matches
 * the region where their browser session is running.
 */
export const REGION_API_URLS: Record<BrowserbaseRegion, string> = {
  "us-west-2": "https://api.stagehand.browserbase.com",
  "us-east-1": "https://api.use1.stagehand.browserbase.com",
  "eu-central-1": "https://api.euc1.stagehand.browserbase.com",
  "ap-southeast-1": "https://api.apse1.stagehand.browserbase.com",
};

/**
 * Returns the full API URL (with /v1 suffix) for a given Browserbase region.
 * If no region is specified or the region is unknown, defaults to us-west-2.
 *
 * @param region - The Browserbase region (e.g., "us-west-2", "eu-central-1")
 * @returns The full API URL including /v1 suffix
 */
export function getApiUrlForRegion(
  region: BrowserbaseRegion | undefined,
): string {
  const baseUrl =
    REGION_API_URLS[region as BrowserbaseRegion] ??
    REGION_API_URLS["us-west-2"];
  return `${baseUrl}/v1`;
}

// =============================================================================
// Client-specific types (can't be Zod schemas due to functions/Page objects)
// =============================================================================
//
// These types mirror the Api.* schemas from types/public/api.ts but include
// non-serializable SDK fields (like Page objects) that get stripped before
// sending requests over the wire.
//
// Relationship to wire format:
// - Client accepts: SDK types (ActOptions, ExtractOptions, etc.) with optional `page`
// - Wire sends: Api.* types (page stripped, Zod schema converted to JSON schema)
// - Client returns: SDK result types (ActResult, ExtractResult, etc.)
// =============================================================================

/**
 * Constructor parameters for StagehandAPIClient
 */
interface StagehandAPIConstructorParams {
  apiKey: string;
  projectId: string;
  logger: (message: LogLine) => void;
  /**
   * When true, enables server-side caching by default for all requests.
   * When false, disables server-side caching.
   * Defaults to true (caching enabled).
   * Can be overridden per-method in act(), extract(), and observe() options.
   */
  serverCache?: boolean;
}

/**
 * Parameters for starting a session via the API client.
 * Extends Api.SessionStartRequest with client-specific field (modelApiKey).
 *
 * Wire format: Api.SessionStartRequest (modelApiKey sent via header, not body)
 */
interface ClientSessionStartParams extends Api.SessionStartRequest {
  /** Model API key - sent via x-model-api-key header, not in request body */
  modelApiKey: string;
}

/**
 * Generic API response wrapper matching Api.*Response schemas
 */
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; message: string };

/**
 * Union of all API request body types for type-safe execute() calls
 */
type ApiRequestBody =
  | Api.ActRequest
  | Api.ExtractRequest
  | Api.ObserveRequest
  | Api.NavigateRequest
  | Api.AgentExecuteRequest;

/**
 * Parameters for executing an action via the streaming API
 */
interface ExecuteActionParams {
  method: "act" | "extract" | "observe" | "navigate" | "end" | "agentExecute";
  args?: ApiRequestBody;
  params?: Record<string, string>;
  /**
   * Override the instance-level serverCache setting for this request.
   * When true, enables server-side caching.
   * When false, disables server-side caching.
   */
  serverCache?: boolean;
}

/**
 * Client parameters for act() method.
 * Derives structure from Api.ActRequest but uses SDK's ActOptions (which includes `page`).
 * Before serialization, `page` is stripped to produce Api.ActRequest wire format.
 */
interface ClientActParameters {
  input: Api.ActRequest["input"];
  options?: ActOptions;
  frameId?: Api.ActRequest["frameId"];
}

/**
 * Client parameters for extract() method.
 * Derives structure from Api.ExtractRequest but uses SDK's ExtractOptions (which includes `page`)
 * and accepts Zod schema (converted to JSON schema for wire format).
 */
interface ClientExtractParameters {
  instruction?: Api.ExtractRequest["instruction"];
  schema?: StagehandZodSchema;
  options?: ExtractOptions;
  frameId?: Api.ExtractRequest["frameId"];
}

/**
 * Client parameters for observe() method.
 * Derives structure from Api.ObserveRequest but uses SDK's ObserveOptions (which includes `page`).
 * Before serialization, `page` is stripped to produce Api.ObserveRequest wire format.
 */
interface ClientObserveParameters {
  instruction?: Api.ObserveRequest["instruction"];
  options?: ObserveOptions;
  frameId?: Api.ObserveRequest["frameId"];
}

export class StagehandAPIClient {
  private apiKey: string;
  private projectId: string;
  private sessionId?: string;
  private modelApiKey: string;
  private modelProvider?: string;
  private region?: BrowserbaseRegion;
  private logger: (message: LogLine) => void;
  private fetchWithCookies;
  private serverCache: boolean;
  private lastFinishedEventData: Record<string, unknown> | null = null;
  private latestAgentCacheEntry: AgentCacheTransferPayload | null = null;

  constructor({
    apiKey,
    projectId,
    logger,
    serverCache,
  }: StagehandAPIConstructorParams) {
    this.apiKey = apiKey;
    this.projectId = projectId;
    this.logger = logger;
    this.serverCache = serverCache ?? true;
    // Create a single cookie jar instance that will persist across all requests
    this.fetchWithCookies = makeFetchCookie(fetch);
  }

  async init({
    modelName,
    modelApiKey,
    domSettleTimeoutMs,
    verbose,
    systemPrompt,
    selfHeal,
    browserbaseSessionCreateParams,
    browserbaseSessionID,
    // browser,  TODO for local browsers
  }: ClientSessionStartParams): Promise<Api.SessionStartResult> {
    if (!modelApiKey) {
      throw new StagehandAPIError("modelApiKey is required");
    }
    this.modelApiKey = modelApiKey;
    // Extract provider from modelName (e.g., "openai/gpt-5-nano" -> "openai")
    this.modelProvider = modelName?.includes("/")
      ? modelName.split("/")[0]
      : undefined;

    // Store the region for multi-region API URL resolution
    this.region = browserbaseSessionCreateParams?.region;

    this.logger({
      category: "init",
      message: "Creating new browserbase session...",
      level: 1,
    });

    // Build wire-format request body (Api.SessionStartRequest shape)
    const requestBody: Api.SessionStartRequest = {
      modelName,
      domSettleTimeoutMs,
      verbose,
      systemPrompt,
      selfHeal,
      browserbaseSessionCreateParams,
      browserbaseSessionID,
      // browser, TODO: only send when connected to local fastify
    };

    const sessionResponse = await this.request("/sessions/start", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });

    if (sessionResponse.status === 401) {
      throw new StagehandAPIUnauthorizedError(
        "Unauthorized. Ensure you provided a valid API key.",
      );
    } else if (sessionResponse.status !== 200) {
      const errorText = await sessionResponse.text();
      this.logger({
        category: "api",
        message: `API error (${sessionResponse.status}): ${errorText}`,
        level: 0,
      });
      throw new StagehandHttpError(`Unknown error: ${sessionResponse.status}`);
    }

    const sessionResponseBody =
      (await sessionResponse.json()) as ApiResponse<Api.SessionStartResult>;

    if (sessionResponseBody.success === false) {
      throw new StagehandAPIError(sessionResponseBody.message);
    }

    // Temporary reroute for rollout
    if (!sessionResponseBody.data?.available && browserbaseSessionID) {
      sessionResponseBody.data.sessionId = browserbaseSessionID;
    }

    this.sessionId = sessionResponseBody.data.sessionId;

    return sessionResponseBody.data;
  }

  async act({
    input,
    options,
    frameId,
  }: ClientActParameters): Promise<ActResult> {
    // Strip non-serializable `page` and SDK-only fields from options before wire serialization
    let wireOptions: Api.ActRequest["options"];
    let serverCache: boolean | undefined;
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, serverCache: enableCache, ...restOptions } = options;
      serverCache = enableCache;
      if (Object.keys(restOptions).length > 0) {
        if (restOptions.model) {
          restOptions.model = this.prepareModelConfig(restOptions.model);
        }
        wireOptions = restOptions as unknown as Api.ActRequest["options"];
      }
    }

    // Build wire-format request body
    const requestBody: Api.ActRequest = {
      input,
      options: wireOptions,
      frameId,
    };

    return this.execute<ActResult>({
      method: "act",
      args: requestBody,
      serverCache,
    });
  }

  async extract<T extends StagehandZodSchema>({
    instruction,
    schema: zodSchema,
    options,
    frameId,
  }: ClientExtractParameters): Promise<ExtractResult<T>> {
    // Convert Zod schema to JSON schema for wire format
    const jsonSchema = zodSchema ? toJsonSchema(zodSchema) : undefined;

    // Strip non-serializable `page` and SDK-only fields from options before wire serialization
    let wireOptions: Api.ExtractRequest["options"];
    let serverCache: boolean | undefined;
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, serverCache: enableCache, ...restOptions } = options;
      serverCache = enableCache;
      if (Object.keys(restOptions).length > 0) {
        if (restOptions.model) {
          restOptions.model = this.prepareModelConfig(restOptions.model);
        }
        wireOptions = restOptions as unknown as Api.ExtractRequest["options"];
      }
    }

    // Build wire-format request body
    const requestBody: Api.ExtractRequest = {
      instruction,
      schema: jsonSchema,
      options: wireOptions,
      frameId,
    };

    return this.execute<ExtractResult<T>>({
      method: "extract",
      args: requestBody,
      serverCache,
    });
  }

  async observe({
    instruction,
    options,
    frameId,
  }: ClientObserveParameters): Promise<ObserveResult> {
    // Strip non-serializable `page` and SDK-only fields from options before wire serialization
    let wireOptions: Api.ObserveRequest["options"];
    let serverCache: boolean | undefined;
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, serverCache: enableCache, ...restOptions } = options;
      serverCache = enableCache;
      if (Object.keys(restOptions).length > 0) {
        if (restOptions.model) {
          restOptions.model = this.prepareModelConfig(restOptions.model);
        }
        wireOptions = restOptions as unknown as Api.ObserveRequest["options"];
      }
    }

    // Build wire-format request body
    const requestBody: Api.ObserveRequest = {
      instruction,
      options: wireOptions,
      frameId,
    };

    return this.execute<ObserveResult>({
      method: "observe",
      args: requestBody,
      serverCache,
    });
  }

  async goto(
    url: string,
    options?: Api.NavigateRequest["options"],
    frameId?: string,
  ): Promise<SerializableResponse | null> {
    const requestBody: Api.NavigateRequest = { url, options, frameId };

    return this.execute<SerializableResponse | null>({
      method: "navigate",
      args: requestBody,
    });
  }

  async agentExecute(
    agentConfig: AgentConfig,
    executeOptions: AgentExecuteOptions | string,
    frameId?: string,
    shouldCache?: boolean,
  ): Promise<AgentResult> {
    // Check if integrations are being used in API mode (not supported)
    if (agentConfig.integrations && agentConfig.integrations.length > 0) {
      throw new ExperimentalNotConfiguredError("MCP integrations");
    }

    // Strip non-serializable `page` from executeOptions before wire serialization
    let wireExecuteOptions: Api.AgentExecuteRequest["executeOptions"];
    if (typeof executeOptions === "string") {
      wireExecuteOptions = { instruction: executeOptions };
    } else if (executeOptions.page) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, ...rest } = executeOptions;
      wireExecuteOptions = rest;
    } else {
      wireExecuteOptions = executeOptions;
    }

    const wireAgentConfig: Api.AgentExecuteRequest["agentConfig"] = {
      systemPrompt: agentConfig.systemPrompt,
      mode: agentConfig.mode ?? (agentConfig.cua === true ? "cua" : undefined),
      cua: agentConfig.mode === undefined ? agentConfig.cua : undefined,
      model: agentConfig.model
        ? this.prepareModelConfig(agentConfig.model)
        : undefined,
      executionModel: agentConfig.executionModel
        ? this.prepareModelConfig(agentConfig.executionModel)
        : undefined,
    };

    // Build wire-format request body
    const requestBody: Api.AgentExecuteRequest = {
      agentConfig: wireAgentConfig,
      executeOptions: wireExecuteOptions,
      frameId,
      shouldCache,
    };

    const result = await this.execute<AgentResult>({
      method: "agentExecute",
      args: requestBody,
    });

    const finishedData =
      this.consumeFinishedEventData<Api.AgentExecuteResult>() ?? null;
    this.latestAgentCacheEntry =
      finishedData?.cacheEntry !== undefined
        ? (finishedData.cacheEntry as AgentCacheTransferPayload)
        : null;
    return result;
  }

  consumeLatestAgentCacheEntry(): AgentCacheTransferPayload | null {
    const entry = this.latestAgentCacheEntry;
    this.latestAgentCacheEntry = null;
    return entry;
  }

  async end(): Promise<Response> {
    const url = `/sessions/${this.sessionId}/end`;
    const response = await this.request(url, {
      method: "POST",
    });
    return response;
  }

  async getReplayMetrics(): Promise<StagehandMetrics> {
    if (!this.sessionId) {
      throw new StagehandAPIError("sessionId is required to fetch metrics.");
    }

    const response = await this.request(`/sessions/${this.sessionId}/replay`, {
      method: "GET",
    });

    if (response.status !== 200) {
      const errorText = await response.text();
      this.logger({
        category: "api",
        message: `Failed to fetch metrics. Status ${response.status}: ${errorText}`,
        level: 0,
      });
      throw new StagehandHttpError(
        `Failed to fetch metrics with status ${response.status}: ${errorText}`,
      );
    }

    const data = (await response.json()) as
      | Api.ReplayResponse
      | { success: false; error?: string };

    if (!data.success) {
      const errorData = data as { success: false; error?: string };
      throw new StagehandAPIError(
        `Failed to fetch metrics: ${errorData.error || "Unknown error"}`,
      );
    }

    // Parse the API data into StagehandMetrics format
    const apiData = (data as Api.ReplayResponse).data;
    const metrics: StagehandMetrics = {
      actPromptTokens: 0,
      actCompletionTokens: 0,
      actReasoningTokens: 0,
      actCachedInputTokens: 0,
      actInferenceTimeMs: 0,
      extractPromptTokens: 0,
      extractCompletionTokens: 0,
      extractReasoningTokens: 0,
      extractCachedInputTokens: 0,
      extractInferenceTimeMs: 0,
      observePromptTokens: 0,
      observeCompletionTokens: 0,
      observeReasoningTokens: 0,
      observeCachedInputTokens: 0,
      observeInferenceTimeMs: 0,
      agentPromptTokens: 0,
      agentCompletionTokens: 0,
      agentReasoningTokens: 0,
      agentCachedInputTokens: 0,
      agentInferenceTimeMs: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalReasoningTokens: 0,
      totalCachedInputTokens: 0,
      totalInferenceTimeMs: 0,
    };

    // Parse pages and their actions
    const pages = apiData?.pages || [];
    for (const page of pages) {
      const actions = page.actions || [];
      for (const action of actions) {
        // Get method name and token usage
        const method = (action.method || "").toLowerCase();
        const tokenUsage = action.tokenUsage;

        if (tokenUsage) {
          const inputTokens = tokenUsage.inputTokens || 0;
          const outputTokens = tokenUsage.outputTokens || 0;
          const reasoningTokens =
            "reasoningTokens" in tokenUsage
              ? Number(
                  (tokenUsage as { reasoningTokens?: number })
                    .reasoningTokens ?? 0,
                )
              : 0;
          const cachedInputTokens =
            "cachedInputTokens" in tokenUsage
              ? Number(
                  (tokenUsage as { cachedInputTokens?: number })
                    .cachedInputTokens ?? 0,
                )
              : 0;
          const timeMs = tokenUsage.timeMs || 0;

          // Map method to metrics fields
          if (method === "act") {
            metrics.actPromptTokens += inputTokens;
            metrics.actCompletionTokens += outputTokens;
            metrics.actReasoningTokens += reasoningTokens;
            metrics.actCachedInputTokens += cachedInputTokens;
            metrics.actInferenceTimeMs += timeMs;
          } else if (method === "extract") {
            metrics.extractPromptTokens += inputTokens;
            metrics.extractCompletionTokens += outputTokens;
            metrics.extractReasoningTokens += reasoningTokens;
            metrics.extractCachedInputTokens += cachedInputTokens;
            metrics.extractInferenceTimeMs += timeMs;
          } else if (method === "observe") {
            metrics.observePromptTokens += inputTokens;
            metrics.observeCompletionTokens += outputTokens;
            metrics.observeReasoningTokens += reasoningTokens;
            metrics.observeCachedInputTokens += cachedInputTokens;
            metrics.observeInferenceTimeMs += timeMs;
          } else if (method === "agent") {
            metrics.agentPromptTokens += inputTokens;
            metrics.agentCompletionTokens += outputTokens;
            metrics.agentReasoningTokens += reasoningTokens;
            metrics.agentCachedInputTokens += cachedInputTokens;
            metrics.agentInferenceTimeMs += timeMs;
          }

          // Always update totals for any method with token usage
          metrics.totalPromptTokens += inputTokens;
          metrics.totalCompletionTokens += outputTokens;
          metrics.totalReasoningTokens += reasoningTokens;
          metrics.totalCachedInputTokens += cachedInputTokens;
          metrics.totalInferenceTimeMs += timeMs;
        }
      }
    }

    return metrics;
  }

  /**
   * Prepares a model configuration for the API payload by ensuring the `apiKey`
   * is included. If the model is passed as a string, converts it to an object
   * with `modelName` and `apiKey`.
   *
   * In API mode, we only attempt to load an API key from env vars when the
   * model provider differs from the one used to init the session.
   */
  private prepareModelConfig(
    model: ModelConfiguration,
  ): { modelName: string; apiKey: string } & Record<string, unknown> {
    if (typeof model === "string") {
      // Extract provider from model string (e.g., "openai/gpt-5-nano" -> "openai")
      const provider = model.includes("/") ? model.split("/")[0] : undefined;
      const apiKey =
        provider && provider !== this.modelProvider
          ? (loadApiKeyFromEnv(provider, this.logger) ?? this.modelApiKey)
          : this.modelApiKey;
      return {
        modelName: model,
        apiKey,
      };
    }

    if (!model.apiKey) {
      const provider = model.modelName?.includes("/")
        ? model.modelName.split("/")[0]
        : undefined;
      const apiKey =
        provider && provider !== this.modelProvider
          ? (loadApiKeyFromEnv(provider, this.logger) ?? this.modelApiKey)
          : this.modelApiKey;
      return {
        ...model,
        apiKey,
      };
    }

    return model as { modelName: string; apiKey: string } & Record<
      string,
      unknown
    >;
  }

  private consumeFinishedEventData<T>(): T | null {
    const data = this.lastFinishedEventData as T | null;
    this.lastFinishedEventData = null;
    return data;
  }

  private async execute<T>({
    method,
    args,
    params,
    serverCache,
  }: ExecuteActionParams): Promise<T> {
    this.lastFinishedEventData = null;
    const urlParams = new URLSearchParams(params as Record<string, string>);
    const queryString = urlParams.toString();
    const url = `/sessions/${this.sessionId}/${method}${queryString ? `?${queryString}` : ""}`;

    const response = await this.request(
      url,
      {
        method: "POST",
        body: JSON.stringify(args),
      },
      serverCache,
    );

    // Capture cache status from response header
    const cacheStatus = response.headers.get("browserbase-cache-status") as
      | "HIT"
      | "MISS"
      | null;

    if (!response.ok) {
      const errorBody = await response.text();
      throw new StagehandHttpError(
        `HTTP error! status: ${response.status}, body: ${errorBody}`,
      );
    }

    if (!response.body) {
      throw new StagehandResponseBodyError();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done && !buffer) {
        throw new StagehandServerError(
          "Stream ended without completion signal",
        );
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        try {
          const eventData = JSON.parse(line.slice(6));

          if (eventData.type === "system") {
            if (eventData.data.status === "error") {
              const { error: errorMsg } = eventData.data;
              // Throw plain Error to match local SDK behavior (useApi: false)
              throw new Error(errorMsg);
            }
            if (eventData.data.status === "finished") {
              this.lastFinishedEventData = eventData.data;

              // If caching was bypassed for this request, suppress cache status
              // so we don't log or surface a MISS that the server emits anyway.
              const cacheEnabled = this.shouldUseCache(serverCache);
              return this.attachCacheStatus(
                eventData.data.result as T,
                method,
                cacheEnabled ? cacheStatus : null,
                cacheEnabled ? eventData : { data: {} },
              );
            }
          } else if (eventData.type === "log") {
            const msg = eventData.data.message;
            // Skip server-side internal logs that don't apply to API mode
            if (msg?.message === "Connecting to local browser") {
              continue;
            }
            this.logger(eventData.data.message);
          }
        } catch (e) {
          // Let Error instances pass through (server errors thrown above)
          // Only wrap SyntaxError from JSON.parse as parse errors
          if (e instanceof Error && !(e instanceof SyntaxError)) {
            throw e;
          }

          const errorMessage = e instanceof Error ? e.message : String(e);
          this.logger({
            category: "api",
            message: `Failed to parse SSE event: ${errorMessage}`,
            level: 0,
          });
          throw new StagehandResponseParseError(
            `Failed to parse server response: ${errorMessage}`,
          );
        }
      }

      if (done) {
        // Process any remaining data in buffer before exiting
        if (buffer.trim() && buffer.startsWith("data: ")) {
          try {
            const eventData = JSON.parse(buffer.slice(6));
            if (
              eventData.type === "system" &&
              eventData.data.status === "finished"
            ) {
              return this.attachCacheStatus(
                eventData.data.result as T,
                method,
                cacheStatus,
                eventData,
              );
            }
          } catch {
            this.logger({
              category: "api",
              message: `Incomplete data in final buffer: ${buffer.substring(0, 100)}`,
              level: 0,
            });
          }
        }
        throw new StagehandServerError(
          "Stream ended without completion signal",
        );
      }
    }
  }

  /**
   * Resolves the final cache status from the response header or SSE event data,
   * logs it, and attaches it to act/extract results before returning.
   */
  private attachCacheStatus<T>(
    result: T,
    method: string,
    cacheStatus: "HIT" | "MISS" | null,
    eventData: { data: { cacheHit?: boolean } },
  ): T {
    const finalCacheStatus =
      cacheStatus ||
      (typeof eventData.data.cacheHit === "boolean"
        ? eventData.data.cacheHit
          ? "HIT"
          : "MISS"
        : undefined);
    if (
      finalCacheStatus &&
      (method === "act" || method === "extract" || method === "observe")
    ) {
      this.logger({
        category: "cache",
        message: `${method} server cache ${finalCacheStatus.toLowerCase()}`,
        level: 1,
      });
    }
    if (
      finalCacheStatus &&
      result &&
      typeof result === "object" &&
      (method === "act" || method === "extract" || method === "observe")
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as ActResult | ExtractResult<any> | ObserveResult).cacheStatus =
        finalCacheStatus;
    }
    return result;
  }

  /**
   * Determine if caching should be enabled for a request.
   * Method-level setting takes precedence over instance-level setting.
   */
  private shouldUseCache(methodServerCache?: boolean): boolean {
    // If method-level setting is explicitly provided, use it
    if (methodServerCache !== undefined) {
      return methodServerCache;
    }
    // Otherwise, use instance-level setting
    return this.serverCache;
  }

  private async request(
    path: string,
    options: RequestInit,
    serverCache?: boolean,
  ): Promise<Response> {
    const defaultHeaders: Record<string, string> = {
      "x-bb-api-key": this.apiKey,
      "x-bb-project-id": this.projectId,
      "x-bb-session-id": this.sessionId,
      // we want real-time logs, so we stream the response
      "x-stream-response": "true",
      "x-model-api-key": this.modelApiKey,
      "x-language": "typescript",
      "x-sdk-version": STAGEHAND_VERSION,
    };

    // Add cache bypass header if caching is disabled
    if (!this.shouldUseCache(serverCache)) {
      defaultHeaders["browserbase-cache-bypass"] = "true";
    }

    if (options.method === "POST" && options.body) {
      defaultHeaders["Content-Type"] = "application/json";
    }

    // Use STAGEHAND_API_URL env var if set, otherwise use region-based URL
    // Ensure /v1 suffix is present for consistency
    let baseUrl: string;
    if (process.env.STAGEHAND_API_URL) {
      const envUrl = process.env.STAGEHAND_API_URL.replace(/\/+$/, "");
      // Append /v1 if not already present
      baseUrl = envUrl.endsWith("/v1") ? envUrl : `${envUrl}/v1`;
    } else {
      baseUrl = getApiUrlForRegion(this.region);
    }

    const response = await this.fetchWithCookies(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    return response;
  }
}
