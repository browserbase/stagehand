import makeFetchCookie from "fetch-cookie";
import { loadApiKeyFromEnv } from "../utils";
import { STAGEHAND_VERSION } from "../version";
import {
  StagehandAPIError,
  StagehandAPIUnauthorizedError,
  StagehandHttpError,
  StagehandResponseBodyError,
  StagehandResponseParseError,
  StagehandServerError,
  ExperimentalNotConfiguredError,
} from "./types/public";
import type {
  Action,
  ActResult,
  AgentConfig,
  AgentExecuteOptions,
  AgentResult,
  ExtractResult,
  LogLine,
  StagehandMetrics,
  ActOptions,
  ExtractOptions,
  ObserveOptions,
  Api,
} from "./types/public";
import type { SerializableResponse } from "./types/private";
import type { ModelConfiguration } from "./types/public/model";
import { toJsonSchema } from "./zodCompat";
import type { StagehandZodSchema } from "./zodCompat";

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
  private logger: (message: LogLine) => void;
  private fetchWithCookies;

  constructor({ apiKey, projectId, logger }: StagehandAPIConstructorParams) {
    this.apiKey = apiKey;
    this.projectId = projectId;
    this.logger = logger;
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

    const region = browserbaseSessionCreateParams?.region;
    if (region && region !== "us-west-2") {
      return { sessionId: browserbaseSessionID ?? null, available: false };
    }

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
    // Strip non-serializable `page` from options before wire serialization
    let wireOptions: Api.ActRequest["options"];
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, ...restOptions } = options;
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

    // Strip non-serializable `page` from options before wire serialization
    let wireOptions: Api.ExtractRequest["options"];
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, ...restOptions } = options;
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
    });
  }

  async observe({
    instruction,
    options,
    frameId,
  }: ClientObserveParameters): Promise<Action[]> {
    // Strip non-serializable `page` from options before wire serialization
    let wireOptions: Api.ObserveRequest["options"];
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, ...restOptions } = options;
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

    return this.execute<Action[]>({
      method: "observe",
      args: requestBody,
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

    // Build wire-format request body
    const requestBody: Api.AgentExecuteRequest = {
      agentConfig,
      executeOptions: wireExecuteOptions,
      frameId,
    };

    return this.execute<AgentResult>({
      method: "agentExecute",
      args: requestBody,
    });
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
    const apiData = data.data || {};
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
    const pages = apiData.pages || [];
    for (const page of pages) {
      const actions = page.actions || [];
      for (const action of actions) {
        // Get method name and token usage
        const method = (action.method || "").toLowerCase();
        const tokenUsage = action.tokenUsage;

        if (tokenUsage) {
          const inputTokens = tokenUsage.inputTokens || 0;
          const outputTokens = tokenUsage.outputTokens || 0;
          const reasoningTokens = tokenUsage.reasoningTokens || 0;
          const cachedInputTokens = tokenUsage.cachedInputTokens || 0;
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

  private async execute<T>({
    method,
    args,
    params,
  }: ExecuteActionParams): Promise<T> {
    const urlParams = new URLSearchParams(params as Record<string, string>);
    const queryString = urlParams.toString();
    const url = `/sessions/${this.sessionId}/${method}${queryString ? `?${queryString}` : ""}`;

    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify(args),
    });

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
              return eventData.data.result as T;
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
              return eventData.data.result as T;
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

  private async request(path: string, options: RequestInit): Promise<Response> {
    const defaultHeaders: Record<string, string> = {
      "x-bb-api-key": this.apiKey,
      "x-bb-project-id": this.projectId,
      "x-bb-session-id": this.sessionId,
      // we want real-time logs, so we stream the response
      "x-stream-response": "true",
      "x-model-api-key": this.modelApiKey,
      "x-sent-at": new Date().toISOString(),
      "x-language": "typescript",
      "x-sdk-version": STAGEHAND_VERSION,
    };
    if (options.method === "POST" && options.body) {
      defaultHeaders["Content-Type"] = "application/json";
    }

    const response = await this.fetchWithCookies(
      `${process.env.STAGEHAND_API_URL ?? "https://api.stagehand.browserbase.com/v1"}${path}`,
      {
        ...options,
        headers: {
          ...defaultHeaders,
          ...options.headers,
        },
      },
    );

    return response;
  }
}
