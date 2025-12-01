import makeFetchCookie from "fetch-cookie";
import { Action } from "./types/public";
import { STAGEHAND_VERSION } from "../version";
import {
  APIActParameters,
  APIExtractParameters,
  APIObserveParameters,
  ApiResponse,
  ExecuteActionParams,
  StagehandAPIConstructorParams,
  StartSessionParams,
  StartSessionResult,
} from "./types/private";
import {
  ActResult,
  AgentConfig,
  AgentExecuteOptions,
  AgentResult,
  ExtractResult,
  LogLine,
  StagehandMetrics,
  StagehandAPIError,
  StagehandAPIUnauthorizedError,
  StagehandHttpError,
  StagehandResponseBodyError,
  StagehandResponseParseError,
  StagehandServerError,
  ExperimentalNotConfiguredError,
} from "./types/public";
import type { SerializableResponse } from "./types/private";
import { toJsonSchema } from "./zodCompat";
import type { StagehandZodSchema } from "./zodCompat";

/**
 * API response structure for replay metrics endpoint
 */
interface ReplayMetricsResponse {
  success: boolean;
  data?: {
    pages?: Array<{
      actions?: Array<{
        method?: string;
        tokenUsage?: {
          inputTokens?: number;
          outputTokens?: number;
          reasoningTokens?: number;
          cachedInputTokens?: number;
          timeMs?: number;
        };
      }>;
    }>;
  };
  error?: string;
}

export class StagehandAPIClient {
  private apiKey: string;
  private projectId: string;
  private sessionId?: string;
  private modelApiKey: string;
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
  }: StartSessionParams): Promise<StartSessionResult> {
    if (!modelApiKey) {
      throw new StagehandAPIError("modelApiKey is required");
    }
    this.modelApiKey = modelApiKey;

    const region = browserbaseSessionCreateParams?.region;
    if (region && region !== "us-west-2") {
      return { sessionId: browserbaseSessionID ?? null, available: false };
    }
    this.logger({
      category: "init",
      message: "Creating new browserbase session...",
      level: 1,
    });
    const sessionResponse = await this.request("/sessions/start", {
      method: "POST",
      body: JSON.stringify({
        modelName,
        domSettleTimeoutMs,
        verbose,
        systemPrompt,
        selfHeal,
        browserbaseSessionCreateParams,
        browserbaseSessionID,
      }),
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
      (await sessionResponse.json()) as ApiResponse<StartSessionResult>;

    if (sessionResponseBody.success === false) {
      throw new StagehandAPIError(sessionResponseBody.message);
    }

    this.sessionId = sessionResponseBody.data.sessionId;

    // Temporary reroute for rollout
    if (!sessionResponseBody.data?.available && browserbaseSessionID) {
      sessionResponseBody.data.sessionId = browserbaseSessionID;
    }

    return sessionResponseBody.data;
  }

  async act({ input, options, frameId }: APIActParameters): Promise<ActResult> {
    const args: Record<string, unknown> = {
      input,
      frameId,
    };
    // Only include options if it has properties (excluding page)
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, ...restOptions } = options;
      if (Object.keys(restOptions).length > 0) {
        args.options = restOptions;
      }
    }

    return this.execute<ActResult>({
      method: "act",
      args,
    });
  }

  async extract<T extends StagehandZodSchema>({
    instruction,
    schema: zodSchema,
    options,
    frameId,
  }: APIExtractParameters): Promise<ExtractResult<T>> {
    const jsonSchema = zodSchema ? toJsonSchema(zodSchema) : undefined;

    const args: Record<string, unknown> = {
      schema: jsonSchema,
      instruction,
      frameId,
    };
    // Only include options if it has properties (excluding page)
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, ...restOptions } = options;
      if (Object.keys(restOptions).length > 0) {
        args.options = restOptions;
      }
    }

    return this.execute<ExtractResult<T>>({
      method: "extract",
      args,
    });
  }

  async observe({
    instruction,
    options,
    frameId,
  }: APIObserveParameters): Promise<Action[]> {
    const args: Record<string, unknown> = {
      instruction,
      frameId,
    };
    // Only include options if it has properties (excluding page)
    if (options) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _, ...restOptions } = options;
      if (Object.keys(restOptions).length > 0) {
        args.options = restOptions;
      }
    }

    return this.execute<Action[]>({
      method: "observe",
      args,
    });
  }

  async goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" },
    frameId?: string,
  ): Promise<SerializableResponse | null> {
    return this.execute<SerializableResponse | null>({
      method: "navigate",
      args: { url, options, frameId },
    });
  }

  async agentExecute(
    agentConfig: AgentConfig,
    executeOptions: AgentExecuteOptions | string,
    frameId?: string,
  ): Promise<AgentResult> {
    // Check if integrations are being used in API mode
    if (agentConfig.integrations && agentConfig.integrations.length > 0) {
      throw new ExperimentalNotConfiguredError("MCP integrations");
    }
    if (typeof executeOptions === "object") {
      if (executeOptions.page) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { page: _, ...restOptions } = executeOptions;
        executeOptions = restOptions;
      }
    }
    return this.execute<AgentResult>({
      method: "agentExecute",
      args: { agentConfig, executeOptions, frameId },
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

    const data = (await response.json()) as ReplayMetricsResponse;

    if (!data.success) {
      throw new StagehandAPIError(
        `Failed to fetch metrics: ${data.error || "Unknown error"}`,
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
