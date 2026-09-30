import path from "node:path";
import {
  MASTRACODE_PROTOCOL_VERSION,
  MASTRACODE_THINKING_LEVELS,
  type MastracodeDriverRequest,
  type MastracodeRequestProvider,
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

/**
 * Every non-facade tool name mastracode's system prompt can describe. mastracode
 * builds its tool guidance (agents/prompts/tool-guidance.ts) from
 * `state.permissionRules.tools`, not from the mode's `availableTools` or
 * `disabledTools`: a tool leaves the prompt only when its rule is "deny". So
 * without these rules the prompt describes view/execute_command/write_file,
 * the task tools, `ask_user` ("use when you need clarification") and, for
 * anthropic/* and openai/* models, web_search/web_extract. A deny rule also
 * deletes the tool from the dynamic tool set (agents/tools.ts).
 */
export const MASTRACODE_PROMPT_DENIED_TOOLS = [
  // MC_TOOLS (tool-names.ts): workspace, LSP, inbox, agent connections.
  "view",
  "write_file",
  "string_replace_lsp",
  "find_files",
  "delete_file",
  "file_stat",
  "mkdir",
  "search_content",
  "ast_smart_edit",
  "execute_command",
  "get_process_output",
  "kill_process",
  "lsp_inspect",
  "notification_inbox",
  "agent_connections_list",
  "agent_connect",
  "agent_disconnect",
  "agent_signal_send",
  // Controller built-ins.
  "ask_user",
  "submit_plan",
  "task_write",
  "task_update",
  "task_complete",
  "task_check",
  "subagent",
  // Web and memory tools.
  "web_search",
  "web_extract",
  "recall",
  "ask_memory",
  "knowledge_search",
  "knowledge_read",
  "knowledge_browse",
] as const;

/** `permissionRules` that deny every non-facade tool (never a facade tool). */
export function buildDenyPermissionRules(facadeToolNames: readonly string[]): {
  categories: Record<string, "deny">;
  tools: Record<string, "deny">;
} {
  const facade = new Set(facadeToolNames);
  const denied = [...new Set([...MASTRACODE_PROMPT_DENIED_TOOLS, ...MASTRACODE_DISABLED_TOOLS])];
  return {
    categories: {},
    tools: Object.fromEntries(
      denied.filter((name) => !facade.has(name)).map((name) => [name, "deny" as const]),
    ),
  };
}

export const MASTRACODE_EVAL_MODE_ID = "eval";

export function defaultModeInstructions(facadeToolNames: readonly string[]): string {
  return [
    `The only tools available in this session are the browser tools ${facadeToolNames.join(", ")}.`,
    "There is no shell, filesystem, git, web search, task list, or subagent in this session; complete the task in the browser.",
    "There is no user to ask: never stop to ask a question or wait for confirmation.",
    "Where other parts of this prompt describe coding workflows, other tools, or asking the user, they do not apply to this session.",
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
      // Removes the non-facade tools from mastracode's tool guidance (see
      // MASTRACODE_PROMPT_DENIED_TOOLS); availableTools alone leaves them in the prompt.
      permissionRules: buildDenyPermissionRules(request.facadeToolNames),
      // Thread titles and observational memory default to google/gemini-3.5-flash
      // (DEFAULT_OM_MODEL_ID), a route with no key in the driver env and invisible
      // to the fetch spy. Pin them to the eval model's route instead.
      observerModelId: sideModelIdFor(request),
      reflectorModelId: sideModelIdFor(request),
    },
  };
}

/** Model for mastracode's side calls (titles, observational memory). */
export function sideModelIdFor(request: MastracodeDriverRequest): string {
  return request.sideModelId?.trim() || request.modelId;
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
  provider: MastracodeRequestProvider;
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
 * Parse usage from an Anthropic Messages, OpenAI Responses/Chat, or Gemini
 * generateContent response body, streamed (SSE) or not. Returns undefined when
 * the body carries none (always for provider `other`).
 */
export function parseProviderResponseUsage(
  provider: InspectedModelRequest["provider"],
  bodyText: string,
): ProviderResponseUsage | undefined {
  const payloads: unknown[] = [];
  const trimmed = bodyText.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      payloads.push(...(Array.isArray(parsed) ? parsed : [parsed]));
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
    if (provider === "google") {
      // Gemini generateContent: every streamed chunk may repeat usageMetadata; keep the latest.
      const meta = isRecord(payload.usageMetadata) ? payload.usageMetadata : undefined;
      if (!meta) continue;
      found = true;
      const prompt = finite(meta.promptTokenCount);
      if (prompt > 0) {
        usage.inputTokens = prompt;
        usage.cachedInputTokens = finite(meta.cachedContentTokenCount);
      }
      const output = finite(meta.candidatesTokenCount) + finite(meta.thoughtsTokenCount);
      if (output > 0) usage.outputTokens = output;
      continue;
    }
    if (provider === "other") continue;
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
 * Responses `tools[].name` (or `type` for provider tools such as web search),
 * Gemini `tools[].functionDeclarations[].name`. A POST to a model API the
 * driver does not parse (Bedrock) is still returned, as provider `other`, so
 * the call is recorded instead of vanishing.
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
  const gemini = /\/models\/([^/:]+):(?:stream)?generateContent$/iu.exec(pathname);
  const bedrock =
    /\/model\/([^/]+)\/(?:converse(?:-stream)?|invoke(?:-with-response-stream)?)$/u.exec(pathname);
  const provider: MastracodeRequestProvider | undefined = /\/messages\/?$/u.test(pathname)
    ? "anthropic"
    : /\/(responses|chat\/completions)\/?$/u.test(pathname)
      ? "openai"
      : gemini
        ? "google"
        : bedrock
          ? "other"
          : undefined;
  if (!provider) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = undefined;
  }
  const cacheBreakpoints = bodyText.match(/"cache_control"\s*:/gu)?.length ?? 0;
  if (provider === "google" || provider === "other") {
    const model =
      provider === "google"
        ? `google/${decodeURIComponent(gemini?.[1] ?? "unknown")}`
        : `bedrock/${decodeURIComponent(bedrock?.[1] ?? "unknown")}`;
    return { provider, model, toolNames: requestToolNames(body), cacheBreakpoints };
  }
  if (!isRecord(body) || typeof body.model !== "string") return undefined;
  return { provider, model: body.model, toolNames: requestToolNames(body), cacheBreakpoints };
}

function requestToolNames(body: unknown): string[] {
  if (!isRecord(body)) return [];
  const names: string[] = [];
  // Bedrock Converse nests tools under toolConfig.tools[].toolSpec.name.
  const tools = Array.isArray(body.tools)
    ? body.tools
    : isRecord(body.toolConfig) && Array.isArray(body.toolConfig.tools)
      ? body.toolConfig.tools
      : [];
  for (const tool of tools) {
    if (!isRecord(tool)) continue;
    if (typeof tool.name === "string") names.push(tool.name);
    else if (isRecord(tool.function) && typeof tool.function.name === "string") {
      names.push(tool.function.name);
    } else if (isRecord(tool.toolSpec) && typeof tool.toolSpec.name === "string") {
      names.push(tool.toolSpec.name);
    } else if (Array.isArray(tool.functionDeclarations)) {
      for (const declaration of tool.functionDeclarations) {
        if (isRecord(declaration) && typeof declaration.name === "string") {
          names.push(declaration.name);
        }
      }
    } else if (typeof tool.type === "string") names.push(tool.type);
    else {
      // Gemini provider tools ({ googleSearch: {} }, { codeExecution: {} }).
      const key = Object.keys(tool)[0];
      if (key) names.push(key);
    }
  }
  return names;
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
  if (
    raw.startupTimeoutMs !== undefined &&
    (!Number.isSafeInteger(raw.startupTimeoutMs) || (raw.startupTimeoutMs as number) <= 0)
  ) {
    throw new Error("mastracode driver request startupTimeoutMs must be a positive integer.");
  }
  if (raw.sideModelId !== undefined && typeof raw.sideModelId !== "string") {
    throw new Error("mastracode driver request sideModelId must be a string.");
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
