import path from "node:path";
import {
  MASTRACODE_PROTOCOL_VERSION,
  MASTRACODE_THINKING_LEVELS,
  type MastracodeDriverRequest,
  type MastracodeStdioServer,
  type MastracodeThinkingLevel,
  type MastracodeTokenUsage,
} from "./protocol.js";

/** The Stagehand facade's MCP tools, as the runner-owned bridge exposes them. */
export const STAGEHAND_FACADE_MCP_TOOLS = ["run", "snapshot", "screenshot"] as const;

/**
 * Exposed tool names for one MCP server. mastracode's MCP manager names every
 * MCP tool `${server}_${tool}` (mcp/manager.ts).
 */
export function toolNamesFor(
  server = "stagehand",
  tools: readonly string[] = STAGEHAND_FACADE_MCP_TOOLS,
): string[] {
  return tools.map((tool) => `${server}_${tool}`);
}

/**
 * Tools mastracode adds to its dynamic tool set outside the workspace and the
 * controller built-ins (agents/tools.ts createDynamicTools). They are removed
 * outright; the eval mode's `availableTools` allowlist hides everything else
 * (workspace tools such as `execute_command`/`write_file`, `ask_user`,
 * `submit_plan`, `task_write`, `subagent`, ...).
 *
 * `web_search` is the Anthropic/OpenAI provider-executed search tool
 * mastracode auto-adds for `anthropic/*` and `openai/*` models; `web_extract`
 * comes with the Tavily/Parallel variants.
 */
export const MASTRACODE_DISABLED_TOOLS = [
  "web_search",
  "web_extract",
  "request_access",
  "notification_inbox",
  "create-workflow",
  "list-workflows",
  "get-workflow",
  "run-workflow",
  "delete-workflow",
] as const;

export const MASTRACODE_EVAL_MODE_ID = "eval";

export function defaultModeInstructions(facadeToolNames: readonly string[]): string {
  return [
    `The only tools available in this session are the browser tools ${facadeToolNames.join(", ")}.`,
    "There is no shell, filesystem, web search, or subagent in this session; complete the task in the browser.",
  ].join(" ");
}

/**
 * The `createMastraCode` options for one eval task. Pure so the isolation
 * settings are unit-testable without loading mastracode.
 */
export function buildMastraCodeConfig(request: MastracodeDriverRequest): Record<string, unknown> {
  return {
    cwd: request.workspaceDir,
    homeDir: request.homeDir,
    settingsPath: path.join(request.appDataDir, "settings.json"),
    modes: [
      {
        id: MASTRACODE_EVAL_MODE_ID,
        name: "Eval",
        defaultModelId: request.modelId,
        availableTools: [...request.facadeToolNames],
        instructions: request.modeInstructions ?? defaultModeInstructions(request.facadeToolNames),
        metadata: { default: true },
      },
    ],
    subagents: [],
    disabledTools: [...MASTRACODE_DISABLED_TOOLS],
    mcpServers: request.mcpServers,
    disableHooks: true,
    disablePlugins: true,
    disableGithubSignals: true,
    disableSettingsOmSeed: true,
    crossAgentSignals: false,
    unixSocketPubSub: false,
    // The default handler re-syncs model catalogs every 5 minutes over the network.
    intervalHandlers: [],
    hostInstructions: request.hostInstructions,
    initialState: {
      yolo: true,
      ...(request.thinkingLevel && { thinkingLevel: request.thinkingLevel }),
    },
  };
}

/** Add one step's usage to a running sum. Optional buckets stay absent until a step reports them. */
export function addTokenUsage(
  sum: MastracodeTokenUsage | undefined,
  step: MastracodeTokenUsage,
): MastracodeTokenUsage {
  const next: MastracodeTokenUsage = {
    promptTokens: (sum?.promptTokens ?? 0) + finite(step.promptTokens),
    completionTokens: (sum?.completionTokens ?? 0) + finite(step.completionTokens),
    totalTokens: (sum?.totalTokens ?? 0) + finite(step.totalTokens),
  };
  for (const key of ["reasoningTokens", "cachedInputTokens", "cacheCreationInputTokens"] as const) {
    const previous = sum?.[key];
    const value = step[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = (previous ?? 0) + value;
    } else if (previous !== undefined) {
      next[key] = previous;
    }
  }
  return next;
}

export function sumTokenUsage(
  steps: readonly MastracodeTokenUsage[],
): MastracodeTokenUsage | undefined {
  return steps.reduce<MastracodeTokenUsage | undefined>(
    (sum, step) => addTokenUsage(sum, step),
    undefined,
  );
}

/** Pick the protocol's usage fields off a mastracode TokenUsage (drops `raw`). */
export function toTokenUsage(value: unknown): MastracodeTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: MastracodeTokenUsage = {
    promptTokens: finite(value.promptTokens),
    completionTokens: finite(value.completionTokens),
    totalTokens: finite(value.totalTokens),
  };
  for (const key of ["reasoningTokens", "cachedInputTokens", "cacheCreationInputTokens"] as const) {
    const field = value[key];
    if (typeof field === "number" && Number.isFinite(field)) usage[key] = field;
  }
  return usage;
}

export interface InspectedModelRequest {
  provider: "anthropic" | "openai" | "other";
  model: string;
  toolNames: string[];
  cacheBreakpoints: number;
}

/**
 * Usage read off one raw provider response, normalized so `inputTokens` is
 * the whole prompt (uncached + cache read + cache write) like AI SDK v6.
 */
export interface ProviderResponseUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
}

/**
 * Parse usage from an Anthropic Messages or OpenAI Responses/Chat response
 * body, streamed (SSE) or not. Returns undefined when the body carries none.
 */
export function parseProviderResponseUsage(
  provider: InspectedModelRequest["provider"],
  bodyText: string,
): ProviderResponseUsage | undefined {
  const payloads: unknown[] = [];
  const trimmed = bodyText.trim();
  if (trimmed.startsWith("{")) {
    try {
      payloads.push(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  } else {
    for (const line of bodyText.split(/\r?\n/u)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        payloads.push(JSON.parse(data));
      } catch {
        // Ignore partial or non-JSON frames.
      }
    }
  }
  let found = false;
  const usage: ProviderResponseUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
  };
  for (const payload of payloads) {
    if (!isRecord(payload)) continue;
    const raw = isRecord(payload.usage)
      ? payload.usage
      : isRecord(payload.message) && isRecord(payload.message.usage)
        ? payload.message.usage
        : isRecord(payload.response) && isRecord(payload.response.usage)
          ? payload.response.usage
          : undefined;
    if (!raw) continue;
    found = true;
    if (provider === "anthropic") {
      // message_start carries the prompt side, message_delta the final output
      // (and repeats the prompt side on newer API versions): keep the latest non-zero.
      const input = finite(raw.input_tokens);
      const read = finite(raw.cache_read_input_tokens);
      const write = finite(raw.cache_creation_input_tokens);
      if (input + read + write > 0) {
        usage.inputTokens = input + read + write;
        usage.cachedInputTokens = read;
        usage.cacheCreationInputTokens = write;
      }
      if (finite(raw.output_tokens) > 0) usage.outputTokens = finite(raw.output_tokens);
    } else {
      const input = finite(raw.input_tokens ?? raw.prompt_tokens);
      const details = isRecord(raw.input_tokens_details)
        ? raw.input_tokens_details
        : isRecord(raw.prompt_tokens_details)
          ? raw.prompt_tokens_details
          : {};
      if (input > 0) {
        usage.inputTokens = input;
        usage.cachedInputTokens = finite(details.cached_tokens);
      }
      const output = finite(raw.output_tokens ?? raw.completion_tokens);
      if (output > 0) usage.outputTokens = output;
    }
  }
  return found ? usage : undefined;
}

/**
 * Classify one outgoing HTTP request. Returns undefined for anything that is
 * not a model call (MCP, telemetry, catalog fetches). Tool names are what the
 * model is actually offered: Anthropic Messages `tools[].name`, OpenAI
 * Responses `tools[].name` (or `type` for provider tools such as web search).
 */
export function inspectModelRequest(
  url: string,
  bodyText: string | undefined,
): InspectedModelRequest | undefined {
  if (!bodyText) return undefined;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const provider = /\/messages\/?$/u.test(pathname)
    ? "anthropic"
    : /\/(responses|chat\/completions)\/?$/u.test(pathname)
      ? "openai"
      : undefined;
  if (!provider) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (!isRecord(body) || typeof body.model !== "string") return undefined;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolNames = tools
    .map((tool) => {
      if (!isRecord(tool)) return undefined;
      if (typeof tool.name === "string") return tool.name;
      if (isRecord(tool.function) && typeof tool.function.name === "string") {
        return tool.function.name;
      }
      return typeof tool.type === "string" ? tool.type : undefined;
    })
    .filter((name): name is string => name !== undefined);
  return {
    provider,
    model: body.model,
    toolNames,
    cacheBreakpoints: bodyText.match(/"cache_control"\s*:/gu)?.length ?? 0,
  };
}

export function unexpectedTools(
  toolNames: readonly string[],
  allowed: readonly string[],
): string[] {
  const allowedSet = new Set(allowed);
  return [...new Set(toolNames.filter((name) => !allowedSet.has(name)))];
}

export function parseThinkingLevel(
  raw: string | undefined,
  source = "mastracode thinking level",
): MastracodeThinkingLevel | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if ((MASTRACODE_THINKING_LEVELS as readonly string[]).includes(value)) {
    return value as MastracodeThinkingLevel;
  }
  throw new Error(`${source} must be one of ${MASTRACODE_THINKING_LEVELS.join(", ")}.`);
}

/** Validate the driver's stdin document. */
export function parseDriverRequest(text: string): MastracodeDriverRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`mastracode driver request is not JSON: ${stringifyError(error)}`);
  }
  if (!isRecord(raw) || raw.version !== MASTRACODE_PROTOCOL_VERSION) {
    throw new Error(`mastracode driver request must have version ${MASTRACODE_PROTOCOL_VERSION}.`);
  }
  for (const key of [
    "prompt",
    "hostInstructions",
    "modelId",
    "workspaceDir",
    "appDataDir",
    "homeDir",
  ]) {
    if (typeof raw[key] !== "string" || !(raw[key] as string)) {
      throw new Error(`mastracode driver request is missing "${key}".`);
    }
  }
  if (!Number.isSafeInteger(raw.stepBudget) || (raw.stepBudget as number) <= 0) {
    throw new Error("mastracode driver request needs a positive integer stepBudget.");
  }
  if (!isStringArray(raw.facadeToolNames) || raw.facadeToolNames.length === 0) {
    throw new Error("mastracode driver request needs facadeToolNames.");
  }
  if (!isRecord(raw.mcpServers)) {
    throw new Error("mastracode driver request needs mcpServers.");
  }
  for (const [name, server] of Object.entries(raw.mcpServers)) {
    if (!isStdioServer(server)) {
      throw new Error(`mastracode MCP server "${name}" must be a stdio definition.`);
    }
  }
  if (raw.thinkingLevel !== undefined) {
    parseThinkingLevel(
      typeof raw.thinkingLevel === "string" ? raw.thinkingLevel : JSON.stringify(raw.thinkingLevel),
      "thinkingLevel",
    );
  }
  return raw as unknown as MastracodeDriverRequest;
}

function isStdioServer(value: unknown): value is MastracodeStdioServer {
  return (
    isRecord(value) &&
    typeof value.command === "string" &&
    (value.args === undefined || isStringArray(value.args)) &&
    (value.env === undefined ||
      (isRecord(value.env) && Object.values(value.env).every((item) => typeof item === "string")))
  );
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function stringifyError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
