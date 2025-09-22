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
import {
  AgentStreamEvent,
  AgentHookHandlers,
  AgentHookEvent,
} from "../types/agentHooks";
import { AgentHookEventHandler } from "./agent/AgentHookEventHandler";
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
    // Check if integrations are being used in API mode
    if (agentConfig.integrations && agentConfig.integrations.length > 0) {
      throw new StagehandAPIError(
        "MCP integrations are not supported in API mode. Please use local mode with experimental: true to use MCP integrations.",
      );
    }

    // Extract hooks from executeOptions to handle on client side
    const hooks: AgentHookHandlers = {
      onStepFinish: executeOptions.onStepFinish,
      onFinish: executeOptions.onFinish,
      onError: executeOptions.onError,
      onChunk: executeOptions.onChunk,
    };

    // Remove hooks from executeOptions to send to server (they can't be serialized)
    const {
      onStepFinish: _onStepFinish, // eslint-disable-line @typescript-eslint/no-unused-vars
      onFinish: _onFinish, // eslint-disable-line @typescript-eslint/no-unused-vars
      onError: _onError, // eslint-disable-line @typescript-eslint/no-unused-vars
      onChunk: _onChunk, // eslint-disable-line @typescript-eslint/no-unused-vars
      ...serializableExecuteOptions
    } = executeOptions;

    // Generate unique execution ID for this agent execution
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Create hook event handler if any hooks are provided
    const hasHooks = !!(
      hooks.onStepFinish ||
      hooks.onFinish ||
      hooks.onError ||
      hooks.onChunk
    );
    let hookEventHandler: AgentHookEventHandler | null = null;

    if (hasHooks) {
      hookEventHandler = new AgentHookEventHandler(
        hooks,
        this.logger,
        executionId,
      );
    }

    return this.execute<AgentResult>({
      method: "agentExecute",
      args: {
        agentConfig,
        executeOptions: serializableExecuteOptions,
        hookConfig: hasHooks
          ? { enableHooks: true, executionId }
          : { enableHooks: false },
      },
      hookEventHandler,
    });
  }

  async end(): Promise<Response> {
    const url = `/sessions/${this.sessionId}/end`;
    const response = await this.request(url, {
      method: "POST",
    });
    return response;
  }

  private async execute<T>({
    method,
    args,
    params,
    hookEventHandler,
  }: ExecuteActionParams & {
    hookEventHandler?: AgentHookEventHandler | null;
  }): Promise<T> {
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
          const eventData: AgentStreamEvent = JSON.parse(line.slice(6));

          if (eventData.type === "system") {
            const systemData = eventData.data as {
              status: string;
              result?: unknown;
              error?: string;
            };
            if (systemData.status === "error") {
              throw new StagehandServerError(
                systemData.error || "Unknown server error",
              );
            }
            if (systemData.status === "finished") {
              return systemData.result as T;
            }
          } else if (eventData.type === "log") {
            // Handle print logs - these are regular log messages for display
            const logData = eventData.data as LogLine;
            this.logger(logData);
          } else if (eventData.type === "hook_event") {
            // Handle event logs - these trigger agent hooks
            if (hookEventHandler) {
              const hookEvent = eventData.data as AgentHookEvent;
              await hookEventHandler.handleEvent(hookEvent);
            } else {
              // If no hook handler is registered, log the event for debugging
              this.logger({
                category: "agent",
                message: `Received hook event but no handler registered: ${(eventData.data as AgentHookEvent).type}`,
                level: 2,
              });
            }
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
