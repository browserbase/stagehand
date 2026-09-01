import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";

export interface EveToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  listMcpTools?: (spec: EveMcpServerSpec) => Promise<EveMcpToolDescriptor[]>;
  nodeModulesDir?: string;
  tmpRoot?: string;
}

export interface EveMcpServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface EveMcpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

type EveMcpClient = Pick<Client, "listTools" | "close">;
type EveMcpConnect = (
  spec: EveMcpServerSpec & { env: Record<string, string> },
  signal?: AbortSignal,
) => Promise<EveMcpClient>;

export interface PreparedEveToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  /** The runner writes the agent definition via writeEveAgentDefinition before boot. */
  appRoot: string;
  env: Record<string, string>;
  promptInstructions: string;
  serverNames: string[];
  toolNames: string[];
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  recordObservation?: () => void;
  observedToolMatcher: (name: string) => boolean;
  cleanup: () => Promise<void>;
}

export const EVE_TOOL_SURFACES: ToolSurface[] = [
  "stagehand_facade",
  "playwright_mcp",
  "chrome_devtools_mcp",
];

export const EVE_MCP_SERVERS_ENV = "STAGEHAND_EVE_MCP_SERVERS";

export const EVE_DISABLED_FRAMEWORK_TOOLS = [
  "bash",
  "read_file",
  "write_file",
  "glob",
  "grep",
  "web_fetch",
  "web_search",
  "agent",
  "ask_question",
  "todo",
  "load_skill",
] as const;

export type EveModelProvider = {
  pkg: "@ai-sdk/openai" | "@ai-sdk/anthropic" | "@ai-sdk/google";
  factory: "openai" | "anthropic" | "google";
  modelId: string;
};

export function eveToolSlug(server: string, tool: string): string {
  const sanitize = (value: string): string => value.replace(/[^A-Za-z0-9_]/g, "_");
  return `${sanitize(server)}__${sanitize(tool)}`;
}

export function resolveEveModelProvider(model: string): EveModelProvider {
  const separator = model.indexOf("/");
  const prefix = separator >= 0 ? model.slice(0, separator) : "openai";
  const modelId = separator >= 0 ? model.slice(separator + 1) : model;
  if (prefix === "openai") return { pkg: "@ai-sdk/openai", factory: "openai", modelId };
  if (prefix === "anthropic") {
    return { pkg: "@ai-sdk/anthropic", factory: "anthropic", modelId };
  }
  if (prefix === "google") return { pkg: "@ai-sdk/google", factory: "google", modelId };
  throw new EvalsError(
    `Eve model "${model}" uses an unsupported provider. Supported prefixes: openai/, anthropic/, google/.`,
  );
}

export function buildEveAgentDefinitionSource(model: string): string {
  const provider = resolveEveModelProvider(model);
  return [
    `import { ${provider.factory} } from ${JSON.stringify(provider.pkg)};`,
    'import { defineAgent } from "eve";',
    "",
    "export default defineAgent({",
    `  model: ${provider.factory}(${JSON.stringify(provider.modelId)}),`,
    "  limits: { maxInputTokensPerSession: false, maxOutputTokensPerSession: false },",
    "});",
    "",
  ].join("\n");
}

export function buildEveAgentAppFiles(options: {
  instructions: string;
  servers: Record<string, EveMcpToolDescriptor[]>;
}): Record<string, string> {
  const files: Record<string, string> = {
    "package.json": `${JSON.stringify(
      { name: "stagehand-evals-eve-agent", private: true, type: "module" },
      null,
      2,
    )}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["agent/**/*.ts"],
      },
      null,
      2,
    )}\n`,
    "agent/instructions.md": `${options.instructions}\n\nNever ask the user questions; decide yourself and continue.\nReturn the final answer as the requested compact JSON in your last message.\n`,
    "agent/lib/mcp-bridge.ts": buildMcpBridgeSource(),
  };
  const usedSlugs = new Set<string>(EVE_DISABLED_FRAMEWORK_TOOLS);
  for (const [server, tools] of Object.entries(options.servers)) {
    for (const tool of tools) {
      const slug = eveToolSlug(server, tool.name);
      if (usedSlugs.has(slug)) {
        throw new EvalsError(`Eve tool slug collision for "${slug}".`);
      }
      usedSlugs.add(slug);
      files[`agent/tools/${slug}.ts`] = buildMcpToolSource(server, tool);
    }
  }
  for (const name of EVE_DISABLED_FRAMEWORK_TOOLS) {
    files[`agent/tools/${name}.ts`] =
      'import { disableTool } from "eve/tools";\nexport default disableTool();\n';
  }
  return files;
}

export async function writeEveAgentApp(options: {
  files: Record<string, string>;
  nodeModulesDir: string;
  tmpRoot?: string;
  prefix: string;
}): Promise<string> {
  const appRoot = await fsp.mkdtemp(path.join(options.tmpRoot ?? os.tmpdir(), options.prefix));
  try {
    for (const [relativePath, contents] of Object.entries(options.files)) {
      const destination = path.join(appRoot, relativePath);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, contents, "utf8");
    }
    await fsp.symlink(options.nodeModulesDir, path.join(appRoot, "node_modules"), "dir");
    return appRoot;
  } catch (error) {
    await fsp.rm(appRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function writeEveAgentDefinition(appRoot: string, model: string): Promise<void> {
  const destination = path.join(appRoot, "agent", "agent.ts");
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.writeFile(destination, buildEveAgentDefinitionSource(model), "utf8");
}

export async function listMcpServerTools(
  spec: EveMcpServerSpec,
  options?: { connect?: EveMcpConnect; timeoutMs?: number },
): Promise<EveMcpToolDescriptor[]> {
  const timeoutMs =
    options?.timeoutMs ?? readPositiveIntEnv("EVAL_EVE_MCP_LIST_TOOLS_TIMEOUT_MS", 60_000);
  const connect = options?.connect ?? connectEveMcpServer;
  const connectController = new AbortController();
  const connectPromise = connect(
    {
      command: spec.command,
      args: spec.args ?? [],
      env: stringOnly({ ...process.env, ...spec.env }),
    },
    connectController.signal,
  );
  let connectTimedOut = false;
  let client: EveMcpClient;
  try {
    client = await withCaptureTimeout(connectPromise, timeoutMs, () => {
      connectTimedOut = true;
      connectController.abort(new Error("Eve MCP connection timed out."));
      return new EvalsError(
        `Eve MCP server command "${spec.command}" timed out after ${timeoutMs}ms while connecting.`,
      );
    });
  } catch (error) {
    if (connectTimedOut) {
      void connectPromise
        .then((lateClient) => lateClient.close())
        .catch((): undefined => undefined);
    }
    throw error;
  }
  try {
    const response = await withCaptureTimeout(
      client.listTools(),
      timeoutMs,
      () =>
        new EvalsError(
          `Eve MCP server command "${spec.command}" timed out after ${timeoutMs}ms while listing tools.`,
        ),
    );
    return response.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description && { description: tool.description }),
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  } finally {
    await withCaptureTimeout(client.close(), timeoutMs).catch((): undefined => undefined);
  }
}

async function connectEveMcpServer(
  spec: EveMcpServerSpec & { env: Record<string, string> },
  signal?: AbortSignal,
): Promise<EveMcpClient> {
  const client = new Client({ name: "stagehand-evals-eve", version: "1.0.0" });
  const transport = new StdioClientTransport(spec);
  try {
    await client.connect(transport, signal ? { signal } : undefined);
    await client.ping(signal ? { signal } : undefined);
    return client;
  } catch (error) {
    await client.close().catch((): undefined => undefined);
    throw error;
  }
}

export async function prepareEveToolAdapter(
  input: EveToolAdapterInput,
): Promise<PreparedEveToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "eve", supportedToolSurfaces: EVE_TOOL_SURFACES },
    input.toolSurface,
  );
  if (!toolSurface) throw new EvalsError("Eve harness requires a tool surface.");
  const startupProfile = resolveStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );
  const runtime = await startAgentToolRuntime({
    toolSurface,
    startupProfile,
    environment: input.environment,
    logger: input.logger,
  });
  let appRoot: string | undefined;
  try {
    const mount = runtime.running.agentMount;
    if (!mount) {
      throw new EvalsError(`Tool surface "${toolSurface}" does not provide an agent mount.`);
    }
    if (mount.via !== "mcp") {
      throw new EvalsError(
        `Eve runs authored tools inside its own dev-server process; agent mounts delivered via "${mount.via}" are not supported yet.`,
      );
    }
    const listTools = input.listMcpTools ?? listMcpServerTools;
    const servers: Record<string, EveMcpToolDescriptor[]> = {};
    for (const [name, rawSpec] of Object.entries(mount.mcpServers)) {
      if (!isRecord(rawSpec) || typeof rawSpec.command !== "string") {
        throw new EvalsError(`Eve MCP server "${name}" must provide a string command.`);
      }
      const spec = rawSpec as unknown as EveMcpServerSpec;
      const tools = await listTools(spec);
      if (tools.length === 0) {
        throw new EvalsError(`Eve MCP server "${name}" listed no tools.`);
      }
      servers[name] = tools;
    }
    const files = buildEveAgentAppFiles({ instructions: mount.promptInstructions, servers });
    const nodeModulesDir =
      input.nodeModulesDir ??
      (await import("@browserbasehq/stagehand-integrations-eve-sdk")).resolveEveAppNodeModulesDir();
    appRoot = await writeEveAgentApp({
      files,
      nodeModulesDir,
      tmpRoot: input.tmpRoot,
      prefix: `stagehand-evals-eve-${toolSurface.replace(/_/g, "-")}-`,
    });
    const capturedAppRoot = appRoot;
    const serverNames = Object.keys(servers);
    const toolNames = Object.entries(servers).flatMap(([server, tools]) =>
      tools.map((tool) => eveToolSlug(server, tool.name)),
    );
    const recorder = runtime.running.captureEvidence
      ? new ObservationRecorder(runtime.running.captureEvidence)
      : undefined;
    let cleanupPromise: Promise<void> | undefined;

    input.logger.log({
      category: "eve",
      message: `Initialized ${toolSurface} MCP mount for Eve (servers: ${serverNames.join(", ")}; tools: ${toolNames.length}).`,
      level: 1,
      auxiliary: {
        startupProfile: { value: startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });

    return {
      toolSurface,
      startupProfile,
      appRoot,
      env: { [EVE_MCP_SERVERS_ENV]: JSON.stringify(mount.mcpServers) },
      promptInstructions: mount.promptInstructions,
      serverNames,
      toolNames,
      ...(runtime.running.captureEvidence && {
        captureEvidence: boundedCaptureEvidence(runtime.running.captureEvidence),
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
        recordObservation: () => void recorder.record(),
      }),
      observedToolMatcher: (name: string) =>
        serverNames.some((server) => name.startsWith(eveToolSlug(server, ""))),
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await withCaptureTimeout(
              runtime.cleanup(),
              readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
            );
          } catch {
            // Cleanup is best-effort, but temp-dir cleanup must run.
          } finally {
            await fsp.rm(capturedAppRoot, { recursive: true, force: true });
          }
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    await withCaptureTimeout(
      runtime.cleanup(),
      readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    if (appRoot) await fsp.rm(appRoot, { recursive: true, force: true });
    throw error;
  }
}

function buildMcpToolSource(server: string, tool: EveMcpToolDescriptor): string {
  const description = tool.description ?? `MCP tool ${tool.name} from ${server}`;
  return [
    'import { defineTool } from "eve/tools";',
    'import { callMcpTool, toModelOutput } from "../lib/mcp-bridge.js";',
    "",
    "export default defineTool({",
    `  description: ${JSON.stringify(description)},`,
    `  inputSchema: ${JSON.stringify(tool.inputSchema, null, 2)},`,
    "  async execute(input) {",
    `    return callMcpTool(${JSON.stringify(server)}, ${JSON.stringify(tool.name)}, (input ?? {}) as Record<string, unknown>);`,
    "  },",
    "  toModelOutput,",
    "});",
    "",
  ].join("\n");
}

function buildMcpBridgeSource(): string {
  return [
    'import { Client } from "@modelcontextprotocol/sdk/client/index.js";',
    'import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";',
    'import { toolOutput, toolOutputPart } from "eve/tools";',
    "",
    `const SERVERS_ENV = ${JSON.stringify(EVE_MCP_SERVERS_ENV)};`,
    "type ServerSpec = { command: string; args?: string[]; env?: Record<string, string> };",
    "const clients = new Map<string, Promise<Client>>();",
    "",
    "function stringOnly(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {",
    '  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));',
    "}",
    "",
    "function readServerSpecs(): Record<string, ServerSpec> {",
    "  const raw = process.env[SERVERS_ENV];",
    "  if (!raw) throw new Error(`Missing ${SERVERS_ENV}.`);",
    "  let parsed: unknown;",
    "  try { parsed = JSON.parse(raw); } catch { throw new Error(`Invalid JSON in ${SERVERS_ENV}.`); }",
    '  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Invalid server map in ${SERVERS_ENV}.`);',
    "  for (const [name, spec] of Object.entries(parsed)) {",
    '    if (!spec || typeof spec !== "object" || Array.isArray(spec) || typeof (spec as ServerSpec).command !== "string") {',
    "      throw new Error(`Invalid MCP server specification for ${name}.`);",
    "    }",
    "  }",
    "  return parsed as Record<string, ServerSpec>;",
    "}",
    "",
    "async function getClient(server: string): Promise<Client> {",
    "  const existing = clients.get(server);",
    "  if (existing) return existing;",
    "  const pending = (async () => {",
    "    const spec = readServerSpecs()[server];",
    "    if (!spec) throw new Error(`Unknown MCP server ${server}.`);",
    '    const client = new Client({ name: "stagehand-evals-eve", version: "0.0.0" });',
    "    await client.connect(new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env: stringOnly({ ...process.env, ...spec.env }) }));",
    "    return client;",
    "  })();",
    "  clients.set(server, pending);",
    "  try { return await pending; } catch (error) { clients.delete(server); throw error; }",
    "}",
    "",
    "export type McpBridgeResult = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean; structuredContent?: unknown };",
    "",
    "export async function callMcpTool(server: string, tool: string, args: Record<string, unknown>): Promise<McpBridgeResult> {",
    "  const client = await getClient(server);",
    "  const raw = await client.callTool({ name: tool, arguments: args });",
    "  const content = Array.isArray(raw.content) ? raw.content.map((block) => {",
    '    if (block.type === "text") return { type: "text", text: block.text };',
    '    if (block.type === "image") return { type: "image", data: block.data, mimeType: block.mimeType };',
    "    return { type: String(block.type) };",
    "  }) : [];",
    "  const result: McpBridgeResult = { content, ...(raw.isError === true && { isError: true }), ...(raw.structuredContent !== undefined && { structuredContent: raw.structuredContent }) };",
    "  if (result.isError) {",
    '    const message = result.content.filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\\n");',
    "    throw new Error(message || `MCP tool ${tool} failed`);",
    "  }",
    "  return result;",
    "}",
    "",
    "export function toModelOutput(result: McpBridgeResult) {",
    "  const parts = result.content.flatMap((block) => {",
    '    if (block.type === "text" && block.text) return [toolOutputPart.text(block.text)];',
    '    if (block.type === "image" && block.data) return [toolOutputPart.file(block.data, { mediaType: block.mimeType ?? "image/png" })];',
    "    return [];",
    "  });",
    "  return parts.length > 0 ? toolOutput.content(parts) : toolOutput.json(result.structuredContent ?? result);",
    "}",
    "",
  ].join("\n");
}

function stringOnly(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function boundedCaptureEvidence(
  capture: () => Promise<ProbeEvidence>,
): () => Promise<ProbeEvidence> {
  return async () => {
    try {
      return await withCaptureTimeout(
        capture(),
        readPositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000),
      );
    } catch {
      return {};
    }
  };
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withCaptureTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error = () =>
    new Error(`eve adapter operation timed out after ${timeoutMs}ms`),
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
