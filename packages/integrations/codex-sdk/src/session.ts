import {
  HarnessAdapterError,
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";

export type CodexEvent = Record<string, unknown>;

export type CodexThread = {
  runStreamed: (
    input: string,
    options?: Record<string, unknown>,
  ) => Promise<{ events: AsyncIterable<CodexEvent> }>;
};

export type CodexSdk = {
  startThread: (options?: Record<string, unknown>) => CodexThread;
};

export type CodexThreadConfig = {
  workingDirectory?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  networkAccessEnabled?: boolean;
  webSearchMode?: string;
  skipGitRepoCheck?: boolean;
};

export type CodexTokenUsage = {
  input_tokens: number;
  /** Absent when the SDK did not report it — never synthesized as 0. */
  cached_input_tokens?: number;
  output_tokens: number;
  /** Absent when the SDK did not report it — never synthesized as 0. */
  reasoning_output_tokens?: number;
};

export type CodexSessionResult = {
  events: CodexEvent[];
  finalMessage: string;
  status: "completed" | "max_turns" | "sdk_error";
  stopReason?: string;
  tokenUsage: CodexTokenUsage;
  iterationError?: unknown;
};

export const CODEX_SDK_PACKAGE = "@openai/codex-sdk";

export async function loadCodexSdk(
  options: {
    env?: Record<string, string>;
    codexPathOverride?: string;
    baseUrl?: string;
    apiKey?: string;
    rawReasoning?: boolean;
    extraConfig?: Record<string, unknown>;
  } = {},
): Promise<CodexSdk> {
  let codexCtor: new (options?: Record<string, unknown>) => CodexSdk;
  try {
    const specifier = CODEX_SDK_PACKAGE;
    const mod = (await import(specifier)) as {
      Codex?: new (options?: Record<string, unknown>) => CodexSdk;
    };
    if (typeof mod.Codex !== "function") throw new Error("Codex export missing");
    codexCtor = mod.Codex;
  } catch (error) {
    const detail = sanitizeErrorMessage(stringifyError(error));
    throw new HarnessAdapterError(
      `Codex SDK harness requires ${CODEX_SDK_PACKAGE}. Install it in the consuming workspace.${detail ? ` ${detail}` : ""}`,
      { cause: error },
    );
  }
  // Construction failures are auth/config problems, not missing installs.
  try {
    return new codexCtor({
      ...(options.env && { env: options.env }),
      ...(options.codexPathOverride && { codexPathOverride: options.codexPathOverride }),
      ...(options.baseUrl && { baseUrl: options.baseUrl }),
      ...(options.apiKey && { apiKey: options.apiKey }),
      config: {
        show_raw_agent_reasoning: options.rawReasoning === true,
        ...options.extraConfig,
      },
    });
  } catch (error) {
    throw new HarnessAdapterError(
      `Failed to initialize the Codex SDK: ${sanitizeErrorMessage(stringifyError(error))}`,
      { cause: error },
    );
  }
}

export function normalizeCodexModel(model: string): string {
  if (model === "codex/default") return "gpt-5.4-mini";
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

export function validateCodexSandboxMode(
  value: unknown,
): "read-only" | "workspace-write" | "danger-full-access" {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") {
    return value;
  }
  // Fail closed: an unset or unrecognized mode must not grant disk writes.
  return "read-only";
}

export function validateCodexApprovalPolicy(
  value: unknown,
): "never" | "on-request" | "on-failure" | "untrusted" {
  if (
    value === "never" ||
    value === "on-request" ||
    value === "on-failure" ||
    value === "untrusted"
  ) {
    return value;
  }
  return "never";
}

export async function runCodexSession(input: {
  prompt: string;
  model: string;
  sdk?: CodexSdk;
  signal?: AbortSignal;
  logger: HarnessLogger;
  thread: CodexThreadConfig;
  outputSchema?: Record<string, unknown>;
  maxToolSteps?: number;
  onToolStep?: () => void | Promise<void>;
}): Promise<CodexSessionResult> {
  const sdk = input.sdk ?? (await loadCodexSdk());
  const events: CodexEvent[] = [];
  let finalMessage = "";
  let stopReason: string | undefined;
  let iterationError: unknown;
  let tokenUsage = emptyTokenUsage();
  const maxToolSteps = positiveInteger(input.maxToolSteps, 100);
  const budgetController = new AbortController();
  const forwardAbort = () => budgetController.abort(input.signal?.reason);
  if (input.signal) {
    if (input.signal.aborted) budgetController.abort(input.signal.reason);
    else input.signal.addEventListener("abort", forwardAbort, { once: true });
  }
  let toolStepCount = 0;
  let budgetExhausted = false;

  try {
    const thread = sdk.startThread({
      ...(input.model && { model: normalizeCodexModel(input.model) }),
      ...(input.thread.workingDirectory && {
        workingDirectory: input.thread.workingDirectory,
      }),
      sandboxMode: validateCodexSandboxMode(input.thread.sandboxMode),
      approvalPolicy: validateCodexApprovalPolicy(input.thread.approvalPolicy),
      networkAccessEnabled: input.thread.networkAccessEnabled ?? true,
      webSearchMode: input.thread.webSearchMode ?? "disabled",
      skipGitRepoCheck: input.thread.skipGitRepoCheck ?? true,
    });
    const streamed = await thread.runStreamed(input.prompt, {
      ...(input.outputSchema && { outputSchema: input.outputSchema }),
      signal: budgetController.signal,
    });

    for await (const event of streamed.events) {
      events.push(event);
      logCodexEvent(input.logger, event);
      if (event.type === "turn.completed" && isRecord(event.usage)) {
        tokenUsage = extractCodexTokenUsage(event.usage);
      } else if (event.type === "turn.failed") {
        stopReason = readCodexErrorMessage(event.error);
      } else if (event.type === "error") {
        stopReason = typeof event.message === "string" ? event.message : "error";
      }

      const item = isRecord(event.item) ? event.item : undefined;
      if (
        event.type === "item.completed" &&
        item?.type === "agent_message" &&
        typeof item.text === "string"
      ) {
        finalMessage = item.text;
      }
      if (
        event.type === "item.completed" &&
        (item?.type === "command_execution" || item?.type === "mcp_tool_call")
      ) {
        toolStepCount += 1;
        if (toolStepCount >= maxToolSteps && !budgetController.signal.aborted) {
          stopReason = `tool step budget exhausted (${maxToolSteps} steps)`;
          budgetExhausted = true;
          budgetController.abort(new Error(stopReason));
        }
        if (item.type === "mcp_tool_call") await input.onToolStep?.();
      }
    }
  } catch (error) {
    iterationError = error;
    input.logger.warn({
      category: "codex",
      message: `Codex stopped before a normal result: ${sanitizeErrorMessage(stringifyError(error))}`,
      level: 0,
      auxiliary: { error: { value: sanitizeErrorMessage(stringifyError(error)), type: "string" } },
    });
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
  }

  return {
    events,
    finalMessage,
    status: resolveCodexStatus(iterationError, stopReason, budgetExhausted),
    ...(stopReason && { stopReason: sanitizeErrorMessage(stopReason) }),
    tokenUsage,
    ...(iterationError !== undefined && { iterationError }),
  };
}

export function resolveCodexStatus(
  iterationError: unknown,
  stopReason?: string,
  budgetExhausted = false,
): "completed" | "max_turns" | "sdk_error" {
  // Tool-step budget exhaustion is the same class of stop as Claude's
  // max_turns, not an SDK failure; callers decide how to score it.
  if (budgetExhausted) return "max_turns";
  return iterationError || stopReason ? "sdk_error" : "completed";
}

export function extractCodexTokenUsage(
  usage: Record<string, unknown> | undefined,
): CodexTokenUsage {
  return {
    input_tokens: toFiniteNumber(usage?.input_tokens),
    output_tokens: toFiniteNumber(usage?.output_tokens),
    ...(usage?.cached_input_tokens !== undefined && {
      cached_input_tokens: toFiniteNumber(usage.cached_input_tokens),
    }),
    ...(usage?.reasoning_output_tokens !== undefined && {
      reasoning_output_tokens: toFiniteNumber(usage.reasoning_output_tokens),
    }),
  };
}

function emptyTokenUsage(): CodexTokenUsage {
  return extractCodexTokenUsage(undefined);
}

export function buildCodexTranscript(events: CodexEvent[]): string {
  return events
    .map((event) => summarizeCodexEvent(event).detail)
    .filter((detail): detail is string => Boolean(detail))
    .join("\n");
}

export function logCodexEvent(logger: HarnessLogger, event: CodexEvent): void {
  const summary = summarizeCodexEvent(event);
  logger.log({
    category: "codex",
    message: summary.message,
    level: 1,
    auxiliary: {
      type: { value: String(event.type ?? "unknown"), type: "string" },
      ...(summary.detail && { detail: { value: summary.detail, type: "string" } }),
    },
  });
}

export function summarizeCodexEvent(event: CodexEvent): { message: string; detail?: string } {
  const type = String(event.type ?? "unknown");
  const item = isRecord(event.item) ? event.item : undefined;
  if (item?.type === "agent_message" && typeof item.text === "string") {
    return { message: `agent: ${clip(item.text, 500)}`, detail: item.text };
  }
  if (item?.type === "command_execution") {
    return {
      message: `command: ${String(item.command ?? "")} ${String(item.status ?? "")}`.trim(),
      detail: safeJson(item),
    };
  }
  if (item?.type === "mcp_tool_call") {
    return {
      message:
        `mcp: ${String(item.server ?? "")}.${String(item.tool ?? "")} ${String(item.status ?? "")}`.trim(),
      detail: safeJson(item),
    };
  }
  if (item?.type === "error" && typeof item.message === "string") {
    return { message: `error item: ${clip(item.message, 500)}`, detail: item.message };
  }
  if (type === "turn.completed")
    return { message: "turn completed", detail: safeJson(event.usage) };
  if (type === "turn.failed") {
    const message = readCodexErrorMessage(event.error) ?? "turn failed";
    return { message: `turn failed: ${clip(message, 500)}`, detail: message };
  }
  if (type === "error" && typeof event.message === "string") {
    return { message: `error: ${clip(event.message, 500)}`, detail: event.message };
  }
  return { message: `${type} event`, detail: safeJson(event) };
}

export function readCodexErrorMessage(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  return safeJson(value);
}

export function toFiniteNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
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
