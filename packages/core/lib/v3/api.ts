import makeFetchCookie from "fetch-cookie";
import zodToJsonSchema from "zod-to-json-schema";
import z from "zod/v3";
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
  StagehandAPIError,
  StagehandAPIUnauthorizedError,
  StagehandHttpError,
  StagehandResponseBodyError,
  StagehandResponseParseError,
  StagehandServerError,
} from "./types/public";

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

  async extract<T extends z.AnyZodObject>({
    instruction,
    schema: zodSchema,
    options,
    frameId,
  }: APIExtractParameters): Promise<ExtractResult<T>> {
    const jsonSchema = zodSchema ? zodToJsonSchema(zodSchema) : undefined;

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
  ): Promise<void> {
    return this.execute<void>({
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
      throw new StagehandAPIError(
        "MCP integrations are not supported in API mode. Set experimental: true to use MCP integrations.",
      );
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
              throw new StagehandServerError(eventData.data.error);
            }
            if (eventData.data.status === "finished") {
              return eventData.data.result as T;
            }
          } else if (eventData.type === "log") {
            this.logger(eventData.data.message);
          }
        } catch (e) {
          // Don't catch and re-throw StagehandServerError
          if (e instanceof StagehandServerError) {
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
