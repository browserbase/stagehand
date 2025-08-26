import { z } from "zod/v3";
import zodToJsonSchema from "zod-to-json-schema";
import {
  ApiResponse,
  ExecuteActionParams,
  StagehandAPIConstructorParams,
  StartSessionParams,
  StartSessionResult,
} from "../types/api";
import { LogLine } from "../types/log";
import { GotoOptions } from "../types/playwright";
import {
  ActOptions,
  ActResult,
  AgentConfig,
  ExtractOptions,
  ExtractResult,
  ObserveOptions,
  ObserveResult,
  StagehandMetrics,
} from "../types/stagehand";
import { AgentExecuteOptions, AgentResult } from ".";
import {
  StagehandAPIUnauthorizedError,
  StagehandHttpError,
  StagehandAPIError,
  StagehandServerError,
  StagehandResponseBodyError,
  StagehandResponseParseError,
} from "../types/stagehandApiErrors";
import makeFetchCookie from "fetch-cookie";
import { STAGEHAND_VERSION } from "./version";

export class StagehandAPI {
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
    debugDom,
    systemPrompt,
    selfHeal,
    waitForCaptchaSolves,
    actionTimeoutMs,
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
    const sessionResponse = await this.request("/sessions/start", {
      method: "POST",
      body: JSON.stringify({
        modelName,
        domSettleTimeoutMs,
        verbose,
        debugDom,
        systemPrompt,
        selfHeal,
        waitForCaptchaSolves,
        actionTimeoutMs,
        browserbaseSessionCreateParams,
        browserbaseSessionID,
      }),
    });

    if (sessionResponse.status === 401) {
      throw new StagehandAPIUnauthorizedError(
        "Unauthorized. Ensure you provided a valid API key and that it is whitelisted.",
      );
    } else if (sessionResponse.status !== 200) {
      console.log(await sessionResponse.text());
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

  async act(options: ActOptions | ObserveResult): Promise<ActResult> {
    return this.execute<ActResult>({
      method: "act",
      args: { ...options },
    });
  }

  async extract<T extends z.AnyZodObject>(
    options: ExtractOptions<T>,
  ): Promise<ExtractResult<T>> {
    if (!options.schema) {
      return this.execute<ExtractResult<T>>({
        method: "extract",
        args: { ...options },
      });
    }
    const parsedSchema = zodToJsonSchema(options.schema);
    return this.execute<ExtractResult<T>>({
      method: "extract",
      args: { ...options, schemaDefinition: parsedSchema },
    });
  }

  async observe(options?: ObserveOptions): Promise<ObserveResult[]> {
    return this.execute<ObserveResult[]>({
      method: "observe",
      args: { ...options },
    });
  }

  async goto(url: string, options?: GotoOptions): Promise<void> {
    return this.execute<void>({
      method: "navigate",
      args: { url, options },
    });
  }

  async agentExecute(
    agentConfig: AgentConfig,
    executeOptions: AgentExecuteOptions,
  ): Promise<AgentResult> {
    return this.execute<AgentResult>({
      method: "agentExecute",
      args: { agentConfig, executeOptions },
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
      throw new Error("sessionId is required to fetch metrics.");
    }

    const response = await this.request(`/sessions/${this.sessionId}/replay`, {
      method: "GET",
    });

    if (response.status !== 200) {
      const errorText = await response.text();
      this.logger({
        category: "api",
        message: `[HTTP ERROR] Failed to fetch metrics. Status ${response.status}: ${errorText}`,
        level: 1,
      });
      throw new Error(
        `Failed to fetch metrics with status ${response.status}: ${errorText}`,
      );
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        `Failed to fetch metrics: ${data.error || "Unknown error"}`,
      );
    }

    // Parse the API data into StagehandMetrics format
    const apiData = data.data || {};
    const metrics: StagehandMetrics = {
      actPromptTokens: 0,
      actCompletionTokens: 0,
      actInferenceTimeMs: 0,
      extractPromptTokens: 0,
      extractCompletionTokens: 0,
      extractInferenceTimeMs: 0,
      observePromptTokens: 0,
      observeCompletionTokens: 0,
      observeInferenceTimeMs: 0,
      agentPromptTokens: 0,
      agentCompletionTokens: 0,
      agentInferenceTimeMs: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalInferenceTimeMs: 0,
    };

    // Parse pages and their actions
    const pages = apiData.pages || [];
    for (const page of pages) {
      const actions = page.actions || [];
      for (const action of actions) {
        // Get method name and token usage
        const method = (action.method || "").toLowerCase();
        const tokenUsage = action.tokenUsage || {};

        if (tokenUsage) {
          const inputTokens = tokenUsage.inputTokens || 0;
          const outputTokens = tokenUsage.outputTokens || 0;
          const timeMs = tokenUsage.timeMs || 0;

          // Map method to metrics fields
          if (method === "act") {
            metrics.actPromptTokens += inputTokens;
            metrics.actCompletionTokens += outputTokens;
            metrics.actInferenceTimeMs += timeMs;
          } else if (method === "extract") {
            metrics.extractPromptTokens += inputTokens;
            metrics.extractCompletionTokens += outputTokens;
            metrics.extractInferenceTimeMs += timeMs;
          } else if (method === "observe") {
            metrics.observePromptTokens += inputTokens;
            metrics.observeCompletionTokens += outputTokens;
            metrics.observeInferenceTimeMs += timeMs;
          } else if (method === "agent") {
            metrics.agentPromptTokens += inputTokens;
            metrics.agentCompletionTokens += outputTokens;
            metrics.agentInferenceTimeMs += timeMs;
          }

          // Always update totals for any method with token usage
          metrics.totalPromptTokens += inputTokens;
          metrics.totalCompletionTokens += outputTokens;
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
        return null;
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
              throw new StagehandServerError(eventData.data.error);
            }
            if (eventData.data.status === "finished") {
              return eventData.data.result as T;
            }
          } else if (eventData.type === "log") {
            this.logger(eventData.data.message);
          }
        } catch (e) {
          console.error("Error parsing event data:", e);
          throw new StagehandResponseParseError(
            "Failed to parse server response",
          );
        }
      }

      if (done) break;
    }
  }

  private async request(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
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
