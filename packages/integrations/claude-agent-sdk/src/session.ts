import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type ClaudeSdkMessage = Record<string, unknown>;
type ClaudeQuery = AsyncIterable<ClaudeSdkMessage>;

export type ClaudeAgentSdk = {
  query: (input: { prompt: string; options?: Record<string, unknown> }) => ClaudeQuery;
};

export type ClaudeSessionConfig = {
  cwd?: string;
  env?: Record<string, string>;
  allowedTools?: string[];
  maxTurns?: number;
  permissionMode?: string;
  pathToClaudeCodeExecutable?: string;
  settingSources?: string[];
  mcpServers?: Record<string, unknown>;
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  systemPromptPreset?: { preset: "claude_code"; append?: string } | string;
};

export type ClaudeCodeTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
};

export type ClaudeSessionResult = {
  messages: ClaudeSdkMessage[];
  resultMessage?: ClaudeSdkMessage;
  resultText: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: ClaudeCodeTokenUsage;
  iterationError?: unknown;
};

export const CLAUDE_AGENT_SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

export async function loadClaudeAgentSdk(): Promise<ClaudeAgentSdk> {
  try {
    const specifier = CLAUDE_AGENT_SDK_PACKAGE;
    const mod = (await import(specifier)) as Partial<ClaudeAgentSdk>;
    if (typeof mod.query !== "function") {
      throw new Error("query export missing");
    }
    return { query: mod.query };
  } catch (error) {
    const detail = sanitizeErrorMessage(stringifyError(error));
    throw new HarnessAdapterError(
      `Claude Agent SDK harness requires ${CLAUDE_AGENT_SDK_PACKAGE}. Install it in the consuming workspace.${detail ? ` ${detail}` : ""}`,
      { cause: error },
    );
  }
}

export function normalizeClaudeModel(model: string): string {
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

export async function runClaudeAgentSession(input: {
  prompt: string;
  model: string;
  sdk?: ClaudeAgentSdk;
  signal?: AbortSignal;
  logger: HarnessLogger;
  session: ClaudeSessionConfig;
  onToolResult?: (toolName: string) => void | Promise<void>;
}): Promise<ClaudeSessionResult> {
  const sdk = input.sdk ?? (await loadClaudeAgentSdk());
  const abortController = new AbortController();
  const forwardAbort = (): void => abortController.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) abortController.abort(input.signal.reason);
    input.signal.addEventListener("abort", forwardAbort, { once: true });
  }

  const messages: ClaudeSdkMessage[] = [];
  let resultText = "";
  let resultMessage: ClaudeSdkMessage | undefined;
  let iterationError: unknown;
  const toolUseNames = new Map<string, string>();
  const systemPrompt =
    typeof input.session.systemPromptPreset === "string"
      ? input.session.systemPromptPreset
      : input.session.systemPromptPreset
        ? { type: "preset", ...input.session.systemPromptPreset }
        : undefined;

  try {
    for await (const message of sdk.query({
      prompt: input.prompt,
      options: {
        abortController,
        // No implicit tool grants: a shared session layer must not default to
        // web access. Callers opt in to every tool explicitly.
        allowedTools: input.session.allowedTools ?? [],
        ...(input.session.canUseTool && { canUseTool: input.session.canUseTool }),
        ...(input.session.cwd && { cwd: input.session.cwd }),
        ...(input.session.env && { env: input.session.env }),
        maxTurns: input.session.maxTurns ?? 50,
        ...(input.session.mcpServers && { mcpServers: input.session.mcpServers }),
        model: normalizeClaudeModel(input.model),
        pathToClaudeCodeExecutable: input.session.pathToClaudeCodeExecutable,
        permissionMode: input.session.permissionMode ?? "default",
        settingSources: input.session.settingSources ?? [],
        stderr: (data: string) => {
          input.logger.log({ category: "claude_code", message: data, level: 1 });
        },
        ...(systemPrompt !== undefined && { systemPrompt }),
      },
    })) {
      messages.push(message);
      logClaudeCodeMessage(input.logger, message);
      await notifyToolResults(message, toolUseNames, input.onToolResult);
      if (message.type === "result") {
        resultMessage = message;
        if (typeof message.result === "string") {
          resultText = message.result;
        } else if (Array.isArray(message.errors)) {
          resultText = message.errors.join("\n");
        }
      }
    }
  } catch (error) {
    iterationError = error;
    input.logger.warn({
      category: "claude_code",
      message: `Claude Code stopped before a normal result: ${sanitizeErrorMessage(stringifyError(error))}`,
      level: 0,
      auxiliary: {
        error: { value: sanitizeErrorMessage(stringifyError(error)), type: "string" },
      },
    });
  } finally {
    // A long-lived caller signal must not accumulate forwarders across
    // sessions that complete without aborting.
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  return {
    messages,
    resultMessage,
    resultText,
    status: resolveClaudeCodeStatus(resultMessage, iterationError),
    stopReason: buildClaudeCodeStopReason(resultMessage, iterationError),
    tokenUsage: extractClaudeCodeTokenUsage(resultMessage),
    ...(iterationError !== undefined && { iterationError }),
  };
}

async function notifyToolResults(
  message: ClaudeSdkMessage,
  toolUseNames: Map<string, string>,
  onToolResult?: (toolName: string) => void | Promise<void>,
): Promise<void> {
  const type = String(message.type ?? "");
  const inner = message.message;
  if (!isRecord(inner) || !Array.isArray(inner.content)) return;

  if (type === "assistant") {
    for (const block of inner.content) {
      if (!isRecord(block) || block.type !== "tool_use") continue;
      if (typeof block.id === "string" && typeof block.name === "string") {
        toolUseNames.set(block.id, block.name);
      }
    }
    return;
  }

  if (type === "user" && onToolResult) {
    for (const block of inner.content) {
      if (!isRecord(block) || block.type !== "tool_result") continue;
      const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
      const name = toolUseNames.get(toolUseId);
      if (name) await onToolResult(name);
    }
  }
}

export function isClaudeCodeMaxTurnsError(value: unknown): boolean {
  const message = stringifyError(value);
  return /(?:maximum number of turns|max(?:imum)? turns|turn limit)/i.test(message);
}

export function resolveClaudeCodeStatus(
  resultMessage: ClaudeSdkMessage | undefined,
  iterationError: unknown,
): "completed" | "max_turns" | "sdk_error" {
  // The SDK reports turn exhaustion structurally on the result message; the
  // prose regex stays only for errors thrown before a result arrives.
  if (resultMessage?.subtype === "error_max_turns") return "max_turns";
  if (isClaudeCodeMaxTurnsError(iterationError)) return "max_turns";
  if (iterationError || resultMessage?.is_error === true) return "sdk_error";
  return "completed";
}

export function buildClaudeCodeStopReason(
  resultMessage: ClaudeSdkMessage | undefined,
  iterationError: unknown,
): string | undefined {
  if (iterationError) return sanitizeErrorMessage(stringifyError(iterationError));
  if (resultMessage?.is_error === true) {
    if (typeof resultMessage.result === "string" && resultMessage.result.trim()) {
      return resultMessage.result.trim();
    }
    if (Array.isArray(resultMessage.errors) && resultMessage.errors.length > 0) {
      return resultMessage.errors.map((error) => String(error)).join("\n");
    }
    return "Claude Code returned an error result";
  }
  return undefined;
}

export function extractClaudeCodeTokenUsage(
  resultMessage: ClaudeSdkMessage | undefined,
): ClaudeCodeTokenUsage {
  const usage = isRecord(resultMessage?.usage) ? resultMessage.usage : undefined;
  const inputTokens =
    readNumber(usage, "input_tokens") ?? sumModelUsage(resultMessage, "inputTokens");
  const outputTokens =
    readNumber(usage, "output_tokens") ?? sumModelUsage(resultMessage, "outputTokens");
  const cacheCreationInputTokens =
    readNumber(usage, "cache_creation_input_tokens") ??
    sumModelUsage(resultMessage, "cacheCreationInputTokens");
  const cacheReadInputTokens =
    readNumber(usage, "cache_read_input_tokens") ??
    sumModelUsage(resultMessage, "cacheReadInputTokens");
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function sumModelUsage(resultMessage: ClaudeSdkMessage | undefined, key: string): number {
  if (!isRecord(resultMessage?.modelUsage)) return 0;
  let total = 0;
  for (const usage of Object.values(resultMessage.modelUsage)) {
    if (isRecord(usage)) total += readNumber(usage, key) ?? 0;
  }
  return total;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!record || !(key in record)) return undefined;
  return toFiniteNumber(record[key]);
}

function toFiniteNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildClaudeCodeTranscript(messages: ClaudeSdkMessage[]): string {
  return messages
    .map((message) => summarizeClaudeCodeMessage(message).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logClaudeCodeMessage(logger: HarnessLogger, message: ClaudeSdkMessage): void {
  const summary = summarizeClaudeCodeMessage(message);
  logger.log({
    category: "claude_code",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: { value: String(message.type ?? "unknown"), type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizeClaudeCodeMessage(message: ClaudeSdkMessage): {
  message: string;
  detail?: string;
} {
  const type = String(message.type ?? "unknown");
  if (type === "assistant") {
    const text = extractText(message);
    return { message: text ? `assistant: ${clip(text, 500)}` : "assistant message", detail: text };
  }
  if (type === "user") {
    const text = extractText(message);
    return { message: text ? `user/tool: ${clip(text, 500)}` : "user/tool message", detail: text };
  }
  if (type === "result") {
    return {
      message: `result: ${String(message.subtype ?? "done")}`,
      detail: typeof message.result === "string" ? message.result : undefined,
    };
  }
  return { message: `${type} message`, detail: safeJson(message) };
}

export function extractText(message: ClaudeSdkMessage): string | undefined {
  const content = message.message;
  if (!isRecord(content)) return undefined;
  const rawContent = content.content;
  if (typeof rawContent === "string") return rawContent;
  if (!Array.isArray(rawContent)) return undefined;
  const parts: string[] = [];
  for (const block of rawContent) {
    if (!isRecord(block)) continue;
    if (typeof block.text === "string") parts.push(block.text);
    else if (typeof block.name === "string") {
      parts.push(`[tool:${block.name}] ${safeJson(block.input) ?? ""}`.trim());
    } else if (typeof block.type === "string") {
      parts.push(`[${block.type}] ${safeJson(block) ?? ""}`.trim());
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function stringifyError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return safeJson(value) ?? String(value);
}

export function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
