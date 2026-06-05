import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { LogLine } from "../types/public/logs.js";
import {
  AgentAction,
  AgentResult,
  AgentType,
  AgentExecutionOptions,
} from "../types/public/agent.js";
import { ClientOptions } from "../types/public/model.js";
import { AgentClient } from "./AgentClient.js";
import { AgentScreenshotProviderError } from "../types/public/sdkErrors.js";
import {
  FlowLogger,
  extractLlmCuaPromptSummary,
  extractLlmCuaResponseSummary,
} from "../flowlogger/FlowLogger.js";
import { v7 as uuidv7 } from "uuid";
import {
  denormalizeCoordinates,
  formatStopAndSummarize,
  formatTaskWithContext,
  mapNavigatorKeyToPlaywright,
  trimImagesToFit,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_KEEP_RECENT_SCREENSHOTS,
} from "./utils/yutoriActions.js";

const NAVIGATOR_BASE_URL = "https://api.yutori.com/v1";
const TOOL_SET_CORE = "browser_tools_core-20260403";

/**
 * Navigator n1.5 tool sets Stagehand currently implements. Acts as the single
 * source of truth: the `YutoriToolSet` union tightens automatically as entries
 * are added (e.g. once the expanded tool set is supported).
 */
export const SUPPORTED_TOOL_SETS = [TOOL_SET_CORE] as const;
export type YutoriToolSet = (typeof SUPPORTED_TOOL_SETS)[number];

function normalizeYutoriModelName(modelName: string): string {
  const name = modelName || "n1.5-latest";
  const slashIndex = name.indexOf("/");
  return slashIndex === -1 ? name : name.slice(slashIndex + 1);
}

/** Token/latency accounting returned by a single model turn. */
interface StepUsage {
  input_tokens: number;
  output_tokens: number;
  inference_time_ms: number;
}

/**
 * Copy `messages` for a request before trimming. `trimImagesToFit` only ever
 * reassigns a message's `content` (it builds a fresh array; it never mutates
 * content parts in place), so a shallow per-message + content-array copy fully
 * protects the persistent `this.messages` history — without deep-cloning the
 * large base64 screenshots that `structuredClone` would duplicate every step.
 */
function cloneMessagesForRequest(
  messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
  return messages.map((message) =>
    Array.isArray(message.content)
      ? { ...message, content: [...message.content] }
      : { ...message },
  ) as ChatCompletionMessageParam[];
}

/**
 * Navigator's non-standard chat-completions parameters. They are sent as
 * extra body fields on the OpenAI-compatible request.
 */
interface NavigatorExtraParams {
  tool_set?: string;
  disable_tools?: string[];
  json_schema?: Record<string, unknown>;
}

/**
 * Client for the Yutori Navigator n1.5 computer-use model.
 *
 * Navigator exposes an OpenAI-compatible Chat Completions API at
 * https://api.yutori.com/v1. The model takes screenshots as image inputs and
 * returns coordinate-based `tool_calls` in a normalized 1000x1000 space. This
 * client mirrors the reference agent loop from the Yutori Python SDK example
 * (examples/navigator_n1_5.py): screenshot-per-turn, `role: "tool"` results
 * with a current-URL suffix, payload trimming, completion when no tool calls
 * are returned, and stop-and-summarize on max steps.
 *
 * @see https://docs.yutori.com/reference/n1-5.md
 */
export class YutoriCUAClient extends AgentClient {
  private apiKey: string;
  private baseURL: string;
  private client: OpenAI;
  private currentViewport = { width: 1280, height: 800 };
  private currentUrl?: string;
  private screenshotProvider?: () => Promise<string>;
  private actionHandler?: (action: AgentAction) => Promise<void>;

  private temperature = 0.3;
  private toolSet = TOOL_SET_CORE;
  // mouse_down / mouse_up have no equivalent in the shared CUA action handler
  // (drag covers press-move-release), so disable them by default. Overridable
  // via clientOptions.disableTools.
  private disableTools: string[] = ["mouse_down", "mouse_up"];
  private jsonSchema?: Record<string, unknown>;
  private userTimezone?: string;
  private userLocation?: string;
  private maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES;
  private keepRecentScreenshots = DEFAULT_KEEP_RECENT_SCREENSHOTS;

  private messages: ChatCompletionMessageParam[] = [];
  private parsedJson?: Record<string, unknown>;

  constructor(
    type: AgentType,
    modelName: string,
    userProvidedInstructions?: string,
    clientOptions?: ClientOptions,
  ) {
    super(type, normalizeYutoriModelName(modelName), userProvidedInstructions);

    this.apiKey =
      (clientOptions?.apiKey as string) || process.env.YUTORI_API_KEY || "";
    this.baseURL = (clientOptions?.baseURL as string) || NAVIGATOR_BASE_URL;

    if (!this.apiKey) {
      throw new Error(
        "API key is required. Provide it via clientOptions.apiKey or the YUTORI_API_KEY environment variable.",
      );
    }

    if (clientOptions?.temperature !== undefined) {
      this.temperature = clientOptions.temperature as number;
    }
    if (typeof clientOptions?.toolSet === "string") {
      this.toolSet = clientOptions.toolSet;
    }
    if (!(SUPPORTED_TOOL_SETS as readonly string[]).includes(this.toolSet)) {
      throw new Error(
        `Yutori Navigator tool set "${this.toolSet}" is not supported by Stagehand yet. ` +
          `Use "${TOOL_SET_CORE}" or omit clientOptions.toolSet.`,
      );
    }
    if (Array.isArray(clientOptions?.disableTools)) {
      this.disableTools = Array.from(
        new Set([
          ...this.disableTools,
          ...(clientOptions.disableTools as string[]),
        ]),
      );
    }
    if (
      clientOptions?.jsonSchema &&
      typeof clientOptions.jsonSchema === "object"
    ) {
      this.jsonSchema = clientOptions.jsonSchema as Record<string, unknown>;
    }
    if (typeof clientOptions?.userTimezone === "string") {
      this.userTimezone = clientOptions.userTimezone;
    }
    if (typeof clientOptions?.userLocation === "string") {
      this.userLocation = clientOptions.userLocation;
    }

    this.clientOptions = { apiKey: this.apiKey, baseURL: this.baseURL };
    this.client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL });
  }

  private navigatorExtraParams(options?: {
    includeJsonSchema?: boolean;
  }): NavigatorExtraParams {
    const includeJsonSchema = options?.includeJsonSchema ?? true;
    return {
      tool_set: this.toolSet,
      ...(this.disableTools.length ? { disable_tools: this.disableTools } : {}),
      ...(includeJsonSchema && this.jsonSchema
        ? { json_schema: this.jsonSchema }
        : {}),
    };
  }

  /**
   * Build the Chat Completions request shared by the step loop and the
   * stop-and-summarize turn. `model`/`messages`/`temperature` stay type-checked;
   * Navigator's extra wire params (tool_set/disable_tools/json_schema) are not
   * part of the OpenAI type, so they are spread on top rather than widening the
   * whole object with a blanket cast.
   *
   * `includeJsonSchema: false` is used for the stop-and-summarize turn, which
   * asks for a free-text progress summary — constraining it to the task's
   * `json_schema` would corrupt that summary message (and the summary turn does
   * not capture `parsed_json` anyway).
   */
  private buildRequest(
    messages: ChatCompletionMessageParam[],
    options?: { includeJsonSchema?: boolean },
  ): ChatCompletionCreateParamsNonStreaming {
    const base: ChatCompletionCreateParamsNonStreaming = {
      model: this.modelName,
      messages,
      temperature: this.temperature,
    };
    return { ...base, ...this.navigatorExtraParams(options) };
  }

  setViewport(width: number, height: number): void {
    this.currentViewport = { width, height };
  }

  setCurrentUrl(url: string): void {
    this.currentUrl = url;
  }

  setScreenshotProvider(provider: () => Promise<string>): void {
    this.screenshotProvider = provider;
  }

  setActionHandler(handler: (action: AgentAction) => Promise<void>): void {
    this.actionHandler = handler;
  }

  async captureScreenshot(options?: {
    base64Image?: string;
    currentUrl?: string;
  }): Promise<string> {
    if (options?.currentUrl) this.currentUrl = options.currentUrl;
    if (options?.base64Image) {
      return `data:image/png;base64,${options.base64Image}`;
    }
    if (this.screenshotProvider) {
      const base64Image = await this.screenshotProvider();
      return `data:image/png;base64,${base64Image}`;
    }
    throw new AgentScreenshotProviderError(
      "`screenshotProvider` has not been set. " +
        "Please call `setScreenshotProvider()` with a valid function that returns a base64-encoded image",
    );
  }

  /**
   * Execute a task with Navigator n1.5.
   * @implements AgentClient.execute
   */
  async execute(executionOptions: AgentExecutionOptions): Promise<AgentResult> {
    const { options, logger } = executionOptions;
    const maxSteps = options.maxSteps || 100;

    // Keep the original instruction for stop-and-summarize; send the
    // context-augmented form (location/timezone/date) to the model.
    const originalTask = options.instruction;
    const task = formatTaskWithContext(
      originalTask,
      this.userTimezone,
      this.userLocation,
    );

    this.messages = [];
    this.parsedJson = undefined;

    if (this.userProvidedInstructions) {
      this.messages.push({
        role: "system",
        content: this.userProvidedInstructions,
      });
    }
    this.messages.push({
      role: "user",
      content: [{ type: "text", text: task }],
    });

    const actions: AgentAction[] = [];
    let finalMessage = "";
    let completed = false;
    let currentStep = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalInferenceTime = 0;

    try {
      while (!completed && currentStep < maxSteps) {
        await this.preStepHook?.();

        logger({
          category: "agent",
          message: `Executing step ${currentStep + 1}/${maxSteps}`,
          level: 1,
        });

        const result = await this.executeStep(logger);
        totalInputTokens += result.usage.input_tokens;
        totalOutputTokens += result.usage.output_tokens;
        totalInferenceTime += result.usage.inference_time_ms;
        actions.push(...result.actions);
        completed = result.completed;
        if (result.message) finalMessage = result.message;
        currentStep++;
      }

      // Loop exhausted without natural completion: ask the model for a final
      // summary instead of returning an empty message.
      if (!completed) {
        logger({
          category: "agent",
          message: `Reached maximum steps (${maxSteps}); requesting final summary`,
          level: 1,
        });
        const summary = await this.stopAndSummarize(originalTask, logger);
        if (summary.message) finalMessage = summary.message;
        totalInputTokens += summary.usage.input_tokens;
        totalOutputTokens += summary.usage.output_tokens;
        totalInferenceTime += summary.usage.inference_time_ms;
      }

      return {
        success: completed,
        completed,
        message: finalMessage,
        actions,
        ...(this.parsedJson ? { output: this.parsedJson } : {}),
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          inference_time_ms: totalInferenceTime,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger({
        category: "agent",
        message: `Error executing agent task: ${errorMessage}`,
        level: 0,
      });
      return {
        success: false,
        completed: false,
        message: `Failed to execute task: ${errorMessage}`,
        actions,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          inference_time_ms: totalInferenceTime,
        },
      };
    }
  }

  /** Append a fresh screenshot to the most recent message and call the model. */
  private async predict(logger: (message: LogLine) => void): Promise<{
    message: ChatCompletion.Choice["message"];
    usage: ChatCompletion["usage"];
    inferenceTimeMs: number;
  }> {
    const screenshotUrl = await this.captureScreenshot();

    // Navigator attaches the screenshot to the latest message's content (the
    // user task on step 1, otherwise the last tool result).
    const last = this.messages[this.messages.length - 1];
    const content = Array.isArray(last.content)
      ? (last.content as unknown[])
      : [{ type: "text", text: String(last.content ?? "") }];
    content.push(
      { type: "text", text: "\n\n" },
      { type: "image_url", image_url: { url: screenshotUrl, detail: "high" } },
    );
    (last as { content: unknown }).content = content;

    // Trim old screenshots from a request copy to stay under the size cap.
    const requestMessages = cloneMessagesForRequest(this.messages);
    const { removed, sizeBytes } = trimImagesToFit(
      requestMessages,
      this.maxRequestBytes,
      this.keepRecentScreenshots,
    );
    if (removed) {
      logger({
        category: "agent",
        message: `Trimmed ${removed} old screenshot(s); payload ~${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`,
        level: 2,
      });
    }

    const requestParams = this.buildRequest(requestMessages);

    const llmRequestId = uuidv7();
    FlowLogger.logLlmRequest({
      requestId: llmRequestId,
      model: this.modelName,
      prompt: extractLlmCuaPromptSummary(requestMessages),
    });

    const startTime = Date.now();
    const response = (await this.client.chat.completions.create(
      requestParams,
    )) as ChatCompletion & { parsed_json?: Record<string, unknown> };
    const inferenceTimeMs = Date.now() - startTime;

    if (response.parsed_json) this.parsedJson = response.parsed_json;

    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error(
        "Navigator returned no choices (empty response from the model API)",
      );
    }
    const message = choice.message;
    FlowLogger.logLlmResponse({
      requestId: llmRequestId,
      model: this.modelName,
      output: extractLlmCuaResponseSummary([{ text: message.content ?? "" }]),
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    });

    return { message, usage: response.usage, inferenceTimeMs };
  }

  /** Run one prediction step: call the model, execute any tool calls. */
  private async executeStep(logger: (message: LogLine) => void): Promise<{
    actions: AgentAction[];
    message: string;
    completed: boolean;
    usage: StepUsage;
  }> {
    const { message, usage, inferenceTimeMs } = await this.predict(logger);

    // Persist a clean assistant turn (role/content/tool_calls only) in history.
    // Echoing the raw response — with null `refusal`/`annotations` fields —
    // back as a request message is rejected by some OpenAI-compatible servers.
    const assistantMessage: ChatCompletionMessageParam = {
      role: "assistant",
      content: message.content ?? "",
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
    this.messages.push(assistantMessage);

    if (message.content) {
      logger({
        category: "agent",
        message: `Reasoning: ${message.content}`,
        level: 1,
      });
    }

    const usageOut = {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
      inference_time_ms: inferenceTimeMs,
    };

    const toolCalls = message.tool_calls ?? [];

    // No tool calls -> the model is done.
    if (toolCalls.length === 0) {
      return {
        actions: [],
        message: message.content ?? "",
        completed: true,
        usage: usageOut,
      };
    }

    // Navigator n1.5 returns its reasoning as the assistant message content
    // (not inside tool-call args), so thread it onto each action. Otherwise the
    // recorded trajectory/replay would have empty reasoning for every Yutori
    // step, unlike the other CUA providers.
    const stepReasoning = message.content || undefined;
    const stepActions: AgentAction[] = [];
    for (const toolCall of toolCalls) {
      const { actions, result } = await this.executeToolCall(
        toolCall,
        logger,
        stepReasoning,
      );
      stepActions.push(...actions);

      // Every tool_call must have a matching tool result message.
      const text = result + this.urlSuffix();
      this.messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: [{ type: "text", text }],
      } as ChatCompletionMessageParam);
    }

    return {
      actions: stepActions,
      message: message.content ?? "",
      completed: false,
      usage: usageOut,
    };
  }

  private urlSuffix(): string {
    return this.currentUrl ? `\nCurrent URL: ${this.currentUrl}` : "";
  }

  /**
   * Convert a Navigator tool call to Stagehand AgentAction(s) (coordinates
   * denormalized to viewport pixels), dispatch them to the action handler,
   * and return a short result string for the model.
   */
  private async executeToolCall(
    toolCall: ChatCompletionMessageToolCall,
    logger: (message: LogLine) => void,
    reasoning?: string,
  ): Promise<{ actions: AgentAction[]; result: string }> {
    const name = toolCall.function.name;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch (parseError) {
      const msg =
        parseError instanceof Error ? parseError.message : String(parseError);
      logger({
        category: "agent",
        message: `Failed to parse ${name} arguments (${msg}): ${toolCall.function.arguments}`,
        level: 1,
      });
      return {
        actions: [],
        result: `[ERROR] Failed to parse arguments: ${toolCall.function.arguments}`,
      };
    }

    let action: AgentAction | null;
    let result: string;
    try {
      const converted = this.convertToolCallToAction(name, args, reasoning);
      action = converted.action;
      result = converted.result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger({
        category: "agent",
        message: `Failed to convert action ${name}: ${msg}`,
        level: 1,
      });
      return { actions: [], result: `[ERROR] ${name}: ${msg}` };
    }

    if (!action) {
      return { actions: [], result };
    }

    if (this.actionHandler) {
      try {
        await this.actionHandler(action);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { actions: [action], result: `[ERROR] ${name}: ${msg}` };
      }
    }

    return { actions: [action], result };
  }

  /**
   * Map a Navigator n1.5 action (core tool set) to a Stagehand AgentAction.
   * Returns `action: null` for tools handled inline (no page interaction).
   */
  private convertToolCallToAction(
    name: string,
    args: Record<string, unknown>,
    stepReasoning?: string,
  ): { action: AgentAction | null; result: string } {
    const { width, height } = this.currentViewport;
    // Prefer the assistant message content (where Navigator n1.5 puts its
    // reasoning); fall back to an inline `thoughts` arg if a tool ever supplies
    // one.
    const reasoning =
      stepReasoning ??
      (typeof args.thoughts === "string"
        ? (args.thoughts as string)
        : undefined);
    const base = reasoning ? { reasoning } : {};

    const coords = (value: unknown): { x: number; y: number } | null => {
      if (!Array.isArray(value) || value.length !== 2) return null;
      return denormalizeCoordinates(value as number[], width, height);
    };

    switch (name) {
      case "left_click":
      case "double_click":
      case "triple_click":
      case "middle_click":
      case "right_click": {
        const point = coords(args.coordinates);
        if (!point) return { action: null, result: "[ERROR] No coordinates" };
        const button =
          name === "middle_click"
            ? "middle"
            : name === "right_click"
              ? "right"
              : "left";
        const clickCount =
          name === "double_click" ? 2 : name === "triple_click" ? 3 : 1;
        return {
          action: {
            ...base,
            type: "click",
            x: point.x,
            y: point.y,
            button,
            clickCount,
            ...(typeof args.modifier === "string"
              ? { modifier: args.modifier }
              : {}),
          },
          result: `Clicked ${clickCount}x with ${button}`,
        };
      }

      case "mouse_move": {
        const point = coords(args.coordinates);
        if (!point) return { action: null, result: "[ERROR] No coordinates" };
        return {
          action: { ...base, type: "move", x: point.x, y: point.y },
          result: "Mouse moved",
        };
      }

      case "type": {
        const text = String(args.text ?? "");
        return {
          action: { ...base, type: "type", text },
          result: `Typed ${text.length} characters`,
        };
      }

      case "key_press":
      case "hold_key": {
        const keyExpr = String(args.key ?? "");
        const keys = mapNavigatorKeyToPlaywright(keyExpr);
        const duration =
          name === "hold_key" && typeof args.duration === "number"
            ? Math.max(0, Math.min(args.duration, 100)) * 1000
            : undefined;
        return {
          action: {
            ...base,
            type: "keypress",
            keys,
            ...(duration && duration > 0 ? { holdMs: duration } : {}),
          },
          result:
            duration && duration > 0
              ? `Held key '${keyExpr}' for ${duration / 1000}s`
              : `Pressed key: ${keyExpr}`,
        };
      }

      case "scroll": {
        const point = coords(args.coordinates);
        if (!point) return { action: null, result: "[ERROR] No coordinates" };
        const direction = String(args.direction ?? "down");
        const amount = typeof args.amount === "number" ? args.amount : 3;
        const px = amount * 100; // 1 unit ~= 100px
        let scroll_x = 0;
        let scroll_y = 0;
        if (direction === "up") scroll_y = -px;
        else if (direction === "down") scroll_y = px;
        else if (direction === "left") scroll_x = -px;
        else if (direction === "right") scroll_x = px;
        return {
          action: {
            ...base,
            type: "scroll",
            x: point.x,
            y: point.y,
            scroll_x,
            scroll_y,
            ...(typeof args.modifier === "string"
              ? { modifier: args.modifier }
              : {}),
          },
          result: `Scrolled ${direction}`,
        };
      }

      case "drag": {
        const start = coords(args.start_coordinates);
        const end = coords(args.coordinates);
        if (!start || !end) {
          return { action: null, result: "[ERROR] Missing drag coordinates" };
        }
        return {
          action: {
            ...base,
            type: "drag",
            path: [
              { x: start.x, y: start.y },
              { x: end.x, y: end.y },
            ],
          },
          result: "Dragged",
        };
      }

      case "goto_url": {
        let url = String(args.url ?? "");
        if (!url.includes("://")) url = `https://${url}`;
        return {
          action: { ...base, type: "goto", url },
          result: `Navigated to ${url}`,
        };
      }

      case "go_back":
        return { action: { ...base, type: "back" }, result: "Navigated back" };

      case "go_forward":
        return {
          action: { ...base, type: "forward" },
          result: "Navigated forward",
        };

      case "refresh":
        return {
          action: { ...base, type: "refresh" },
          result: "Refreshed the page",
        };

      case "wait": {
        const duration = Math.max(0, Math.min(Number(args.duration ?? 5), 100));
        return {
          action: { ...base, type: "wait", timeMs: duration * 1000 },
          result: `Waited ${duration}s`,
        };
      }

      default:
        return {
          action: null,
          result: `[ERROR] Unsupported action: ${name}`,
        };
    }
  }

  /**
   * After max steps, append a final screenshot + stop-and-summarize message
   * and call the model once more to extract a text summary.
   */
  private async stopAndSummarize(
    task: string,
    logger: (message: LogLine) => void,
  ): Promise<{
    message: string;
    usage: StepUsage;
  }> {
    try {
      const screenshotUrl = await this.captureScreenshot();
      this.messages.push({
        role: "user",
        content: [
          { type: "text", text: formatStopAndSummarize(task) },
          { type: "text", text: "\n\n" },
          {
            type: "image_url",
            image_url: { url: screenshotUrl, detail: "high" },
          },
        ],
      } as ChatCompletionMessageParam);

      // predict() would re-append a screenshot; call the API directly here.
      const requestMessages = cloneMessagesForRequest(this.messages);
      trimImagesToFit(
        requestMessages,
        this.maxRequestBytes,
        this.keepRecentScreenshots,
      );
      const startTime = Date.now();
      // Omit json_schema: this turn asks for a free-text summary, not the
      // task's structured output.
      const response = (await this.client.chat.completions.create(
        this.buildRequest(requestMessages, { includeJsonSchema: false }),
      )) as ChatCompletion;
      const inferenceTimeMs = Date.now() - startTime;
      const choice = response.choices?.[0];
      if (!choice?.message) {
        throw new Error(
          "Navigator returned no choices for the summary request",
        );
      }
      const message = choice.message;
      this.messages.push(message as ChatCompletionMessageParam);
      return {
        message: message.content ?? "",
        usage: {
          input_tokens: response.usage?.prompt_tokens ?? 0,
          output_tokens: response.usage?.completion_tokens ?? 0,
          inference_time_ms: inferenceTimeMs,
        },
      };
    } catch (error) {
      logger({
        category: "agent",
        message: `Failed to get stop summary: ${error instanceof Error ? error.message : String(error)}`,
        level: 0,
      });
      // Return a deterministic message rather than "" so the caller surfaces an
      // explanation instead of a blank result on the max-steps path.
      return {
        message:
          "Reached the maximum number of steps and could not generate a summary.",
        usage: { input_tokens: 0, output_tokens: 0, inference_time_ms: 0 },
      };
    }
  }
}
