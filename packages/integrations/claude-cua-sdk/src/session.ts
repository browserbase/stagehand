import Anthropic from "@anthropic-ai/sdk";
import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";
import {
  ANTHROPIC_BROWSER_TOOLSET_NAME,
  BROWSER_TOOLSET_BATCH_HALT_TEXT,
  buildBrowserToolsetDeclaration,
  isBrowserToolsetMember,
  type BrowserToolsetConfigs,
  type CuaToolExecutor,
  type CuaToolResult,
  type CuaToolResultBlock,
} from "./toolset.js";

/** The subset of a Messages API response the loop reads. */
export type CuaApiMessage = {
  id?: string;
  content: Array<Record<string, unknown>>;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};

/**
 * Anything that can answer a Messages API request. The default wraps
 * `client.beta.messages.create`; tests pass a scripted implementation.
 */
export type CuaMessagesClient = {
  create(
    params: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<CuaApiMessage>;
};

export type CuaThinkingConfig =
  | {
      type: "adaptive";
      effort?: "low" | "medium" | "high" | "xhigh" | "max";
      display?: "summarized" | "omitted";
    }
  | { type: "enabled"; budgetTokens: number }
  | { type: "disabled" };

export type ClaudeCuaSessionEvent =
  | {
      type: "assistant";
      turn: number;
      content: Array<Record<string, unknown>>;
      stopReason?: string;
      usage: ClaudeCuaTurnUsage;
    }
  | { type: "tool_use"; turn: number; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      turn: number;
      toolUseId: string;
      name: string;
      content: string | CuaToolResultBlock[];
      isError: boolean;
      durationMs: number;
    };

export type ClaudeCuaTurnUsage = {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
};

export type ClaudeCuaTokenUsage = ClaudeCuaTurnUsage & { total: number };

export type ClaudeCuaSessionStatus = "completed" | "max_turns" | "sdk_error";

export type ClaudeCuaSessionResult = {
  events: ClaudeCuaSessionEvent[];
  /** Text of the last assistant message without tool calls (the report). */
  finalMessage: string;
  status: ClaudeCuaSessionStatus;
  /** Last API stop_reason, or the error description on sdk_error. */
  stopReason?: string;
  tokenUsage: ClaudeCuaTokenUsage;
  /** Whether any response supplied a finite nonnegative token counter (including real zero). */
  usageReported: boolean;
  /** API round trips made. */
  turns: number;
  /** Tool members executed (each tool_use block counts one). */
  toolCalls: number;
  iterationError?: unknown;
};

export type ClaudeCuaSessionInput = {
  prompt: string;
  /** Provider-prefixed ("anthropic/claude-sonnet-5") or bare model id. */
  model: string;
  logger: HarnessLogger;
  signal?: AbortSignal;
  /** API round trips before the session stops with `max_turns`. */
  maxTurns: number;
  tools: CuaToolExecutor;
  systemPrompt?: string;
  /**
   * Defaults to adaptive thinking with summarized display at xhigh effort.
   */
  thinking?: CuaThinkingConfig;
  /** Member overrides merged over the default (`javascript_exec` on). */
  toolsetConfigs?: BrowserToolsetConfigs;
  maxTokens?: number;
  /** Extra `anthropic-beta` flags; the toolset itself needs none. */
  betas?: string[];
  /**
   * Older screenshots are replaced with a placeholder once more than this
   * many image blocks are in the transcript, bounding context growth.
   */
  keepRecentImages?: number;
  client?: CuaMessagesClient;
};

const DEFAULT_MAX_TOKENS = 16_000;
const DEFAULT_KEEP_RECENT_IMAGES = 3;
/** Consecutive `max_tokens` truncations nudged past before the session fails. */
const MAX_TOKENS_CONTINUATIONS = 2;
const MAX_TOKENS_NUDGE =
  "Your previous response was cut off because it reached the output token limit. Continue the task from where you left off; keep any text brief and prefer tool calls.";
const IMAGE_PLACEHOLDER = "[earlier screenshot omitted]";

export function normalizeClaudeCuaModel(model: string): string {
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

export function createAnthropicMessagesClient(options?: {
  apiKey?: string;
  baseURL?: string;
}): CuaMessagesClient {
  const client = new Anthropic({
    ...(options?.apiKey && { apiKey: options.apiKey }),
    ...(options?.baseURL && { baseURL: options.baseURL }),
  });
  return {
    create: (params, requestOptions) =>
      // The SDK types predate the fixed-member toolset declaration; the body
      // is passed through unchanged.
      client.beta.messages.create(
        params as unknown as Parameters<typeof client.beta.messages.create>[0],
        requestOptions,
      ) as unknown as Promise<CuaApiMessage>,
  };
}

/**
 * Run the Anthropic Messages API loop with the Browser Use toolset until the
 * model answers without tool calls, the turn budget runs out, or a request /
 * fatal executor error ends the session. Tool members run sequentially; a
 * failed member halts the rest of that turn (spec'd batch contract).
 */
export async function runClaudeCuaSession(
  input: ClaudeCuaSessionInput,
): Promise<ClaudeCuaSessionResult> {
  const client = input.client ?? createAnthropicMessagesClient();
  const model = normalizeClaudeCuaModel(input.model);
  const keepRecentImages = input.keepRecentImages ?? DEFAULT_KEEP_RECENT_IMAGES;
  const events: ClaudeCuaSessionEvent[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: input.prompt },
  ];
  let usageReported = false;
  const usage: ClaudeCuaTokenUsage = {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_creation: 0,
    total: 0,
  };
  let finalMessage = "";
  let turns = 0;
  let toolCalls = 0;
  let maxTokensContinuations = 0;
  let status: ClaudeCuaSessionStatus = "max_turns";
  let stopReason: string | undefined;
  let iterationError: unknown;

  const log = (message: string, level: 0 | 1 | 2 = 2) =>
    input.logger.log({ category: "claude_cua", message, level });

  try {
    while (turns < input.maxTurns) {
      throwIfAborted(input.signal);
      turns += 1;
      compressTranscriptImages(messages, keepRecentImages);
      const params = buildRequestParams({ ...input, model, messages });
      const response = await client.create(params, input.signal ? { signal: input.signal } : {});
      const rawUsage = response.usage;
      usageReported ||=
        rawUsage !== undefined &&
        [
          rawUsage.input_tokens,
          rawUsage.output_tokens,
          rawUsage.cache_read_input_tokens,
          rawUsage.cache_creation_input_tokens,
        ].some((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
      const turnUsage = readUsage(response);
      usage.input += turnUsage.input;
      usage.output += turnUsage.output;
      usage.cache_read += turnUsage.cache_read;
      usage.cache_creation += turnUsage.cache_creation;
      const content = Array.isArray(response.content) ? response.content : [];
      stopReason = response.stop_reason ?? undefined;
      events.push({ type: "assistant", turn: turns, content, stopReason, usage: turnUsage });
      log(
        `turn ${turns}/${input.maxTurns}: ${content.length} blocks, stop_reason=${stopReason ?? "?"}, in=${turnUsage.input} (cache read ${turnUsage.cache_read}, write ${turnUsage.cache_creation}) out=${turnUsage.output}`,
      );

      // A refusal is HTTP 200 with no tool calls; without this the run would
      // read as a clean completion.
      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.category ?? undefined;
        throw new HarnessAdapterError(
          `Model refused to continue${category ? ` (category: ${category})` : ""}${
            response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""
          }`,
        );
      }

      // Echo the assistant turn verbatim (thinking blocks and toolset_name included).
      messages.push({ role: "assistant", content });
      const toolUses = content.filter((block) => block.type === "tool_use");
      const text = content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n")
        .trim();

      if (toolUses.length === 0) {
        if (response.stop_reason === "max_tokens") {
          if (maxTokensContinuations >= MAX_TOKENS_CONTINUATIONS) {
            throw new HarnessAdapterError(
              `Model response was truncated by max_tokens ${maxTokensContinuations + 1} times in a row`,
            );
          }
          maxTokensContinuations += 1;
          log(
            `response truncated by max_tokens; asking the model to continue (${maxTokensContinuations}/${MAX_TOKENS_CONTINUATIONS})`,
            1,
          );
          messages.push({ role: "user", content: MAX_TOKENS_NUDGE });
          continue;
        }
        finalMessage = text;
        status = "completed";
        break;
      }
      maxTokensContinuations = 0;

      const toolResults: Array<Record<string, unknown>> = [];
      let halted = false;
      for (const block of toolUses) {
        const id = typeof block.id === "string" ? block.id : "";
        const name = typeof block.name === "string" ? block.name : "";
        const toolInput = isRecord(block.input) ? block.input : {};
        const isBrowserMember =
          block.toolset_name === ANTHROPIC_BROWSER_TOOLSET_NAME ||
          (block.toolset_name === undefined && isBrowserToolsetMember(name));
        events.push({ type: "tool_use", turn: turns, id, name, input: toolInput });
        toolCalls += 1;

        let result: CuaToolResult;
        const startedAt = performance.now();
        if (!isBrowserMember) {
          result = {
            content: `Error: unknown tool "${name}". Only browser toolset members are available.`,
            isError: true,
          };
        } else if (halted) {
          result = { content: BROWSER_TOOLSET_BATCH_HALT_TEXT, isError: true };
        } else {
          throwIfAborted(input.signal);
          result = await input.tools.execute(name, toolInput, {
            toolUseId: id,
            signal: input.signal,
          });
        }
        if (result.isError) halted = true;
        const durationMs = performance.now() - startedAt;
        events.push({
          type: "tool_result",
          turn: turns,
          toolUseId: id,
          name,
          content: result.content,
          isError: result.isError === true,
          durationMs,
        });
        log(
          `${name} → ${result.isError ? "error" : "ok"} (${Math.round(durationMs)}ms)`,
          result.isError ? 1 : 2,
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: id,
          ...(isBrowserMember && { toolset_name: ANTHROPIC_BROWSER_TOOLSET_NAME }),
          // Compression replaces blocks in this array. Keep it separate from
          // the original screenshot evidence retained in session events.
          content: typeof result.content === "string" ? result.content : [...result.content],
          ...(result.isError && { is_error: true }),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (error) {
    status = "sdk_error";
    iterationError = error;
    stopReason = input.signal?.aborted
      ? `aborted: ${sanitizeErrorMessage(abortReason(input.signal))}`
      : sanitizeErrorMessage(stringifyError(error));
    input.logger.warn({
      category: "claude_cua",
      message: `session ended with error: ${stopReason}`,
      level: 1,
    });
  }

  if (status === "max_turns") {
    log(`turn budget of ${input.maxTurns} exhausted`, 1);
  }
  usage.total = usage.input + usage.output + usage.cache_read + usage.cache_creation;
  return {
    events,
    finalMessage,
    status,
    stopReason,
    tokenUsage: usage,
    usageReported,
    turns,
    toolCalls,
    ...(iterationError !== undefined && { iterationError }),
  };
}

function buildRequestParams(input: {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  systemPrompt?: string;
  thinking?: CuaThinkingConfig;
  toolsetConfigs?: BrowserToolsetConfigs;
  maxTokens?: number;
  betas?: string[];
}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: input.messages,
    tools: [buildBrowserToolsetDeclaration(input.toolsetConfigs)],
    // tools + system + the growing transcript are a stable prefix across
    // turns; the top-level breakpoint caches the last cacheable block.
    cache_control: { type: "ephemeral" },
  };
  if (input.systemPrompt) params.system = input.systemPrompt;
  if (input.betas?.length) params.betas = input.betas;
  const thinking = input.thinking ?? { type: "adaptive", effort: "xhigh" };
  if (thinking.type === "adaptive") {
    // Claude 5 / Opus 4.7+ default to display "omitted" (empty thinking text);
    // the transcript wants the summary so steps carry reasoning.
    params.thinking = { type: "adaptive", display: thinking.display ?? "summarized" };
    if (thinking.effort) params.output_config = { effort: thinking.effort };
  } else if (thinking.type === "enabled") {
    params.thinking = { type: "enabled", budget_tokens: thinking.budgetTokens };
  }
  return params;
}

function readUsage(response: CuaApiMessage): ClaudeCuaTurnUsage {
  const usage = response.usage ?? {};
  return {
    input: nonNegative(usage.input_tokens),
    output: nonNegative(usage.output_tokens),
    cache_read: nonNegative(usage.cache_read_input_tokens),
    cache_creation: nonNegative(usage.cache_creation_input_tokens),
  };
}

/**
 * Replace every image block except the `keep` most recent ones with a text
 * placeholder. Mutates tool_result content in place; the API is stateless so
 * the next request simply carries the smaller transcript.
 */
export function compressTranscriptImages(
  messages: Array<{ role: string; content: unknown }>,
  keep: number,
): void {
  const images: Array<{ blocks: unknown[]; index: number }> = [];
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== "tool_result" || !Array.isArray(block.content)) {
        continue;
      }
      block.content.forEach((inner: unknown, index: number) => {
        if (isRecord(inner) && inner.type === "image") {
          images.push({ blocks: block.content as unknown[], index });
        }
      });
    }
  }
  const excess = images.length - Math.max(0, keep);
  for (let i = 0; i < excess; i += 1) {
    const { blocks, index } = images[i]!;
    blocks[index] = { type: "text", text: IMAGE_PLACEHOLDER };
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new HarnessAdapterError(`session aborted: ${abortReason(signal)}`);
  }
}

function abortReason(signal: AbortSignal): string {
  if (signal.reason instanceof Error) return signal.reason.message;
  return signal.reason === undefined ? "aborted" : String(signal.reason);
}

function nonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function stringifyError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
