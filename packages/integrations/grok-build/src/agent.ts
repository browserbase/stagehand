import type {
  AcpFacadeAgentProfile,
  RunAcpFacadeAgentOptions,
} from "@browserbasehq/stagehand-integrations/acp";
import { runAcpFacadeAgent } from "@browserbasehq/stagehand-integrations/acp";
import { FACADE_TOOLS } from "@browserbasehq/stagehand-integrations/facade";
import { createRequire } from "node:module";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const STAGEHAND_GROK_TOOL_NAMES = new Set(
  FACADE_TOOLS.map((tool) => `stagehand__${tool.name}`),
);

/** Grok ACP agent-profile filename. `--tools` is documented as headless-only; this allowlist applies in `agent stdio`. */
export const STAGEHAND_GROK_AGENT_PROFILE = "stagehand-browser.md";

const GROK_AGENT_PROFILE = [
  "---",
  "name: stagehand-browser",
  "description: Browser-only Stagehand MCP agent. Discover and invoke Stagehand tools; do not use shell, files, or subagents.",
  "tools:",
  "  - search_tool",
  "  - use_tool",
  "disallowedTools:",
  "  - Agent",
  "---",
  "",
  "Use only Stagehand browser tools discovered through MCP.",
  "",
].join("\n");

export type GrokRuntime = {
  root: string;
  userHome: string;
  cwd: string;
  grokHome: string;
  agentProfilePath: string;
  cachedAuthAvailable: boolean;
};

export type RunGrokBuildOptions = {
  env?: NodeJS.ProcessEnv;
  grokExecutable?: string;
  facadeServerPath?: string;
  signal?: AbortSignal;
  makeRuntime?: (env: NodeJS.ProcessEnv) => Promise<GrokRuntime>;
  runAcp?: (options: RunAcpFacadeAgentOptions) => Promise<string>;
};

export function resolveGrokExecutable(): string {
  return require.resolve("@xai-official/grok/bin/grok");
}

export function resolveGrokAuthHome(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.GROK_HOME?.trim();
  if (configured) return configured;
  const userHome = env.HOME?.trim() || env.USERPROFILE?.trim();
  return userHome ? join(userHome, ".grok") : undefined;
}

export function grokAcpArgs(agentProfilePath: string): string[] {
  return [
    "--tools",
    "search_tool,use_tool",
    "--deny",
    "Bash",
    "--deny",
    "Edit",
    "--deny",
    "Write",
    "--deny",
    "Read",
    "--deny",
    "Grep",
    "--deny",
    "WebFetch",
    "--no-plan",
    "--no-subagents",
    "--no-memory",
    "--disable-web-search",
    "agent",
    "--no-leader",
    "--agent-profile",
    agentProfilePath,
    "stdio",
  ];
}

export function createGrokProfile(options: {
  executable: string;
  cachedAuthAvailable: boolean;
  agentProfilePath: string;
}): AcpFacadeAgentProfile {
  return {
    id: "grok-build",
    command: options.executable,
    args: grokAcpArgs(options.agentProfilePath),
    resolveAuthentication: ({ initialization, env }) => {
      const advertised = new Set((initialization.authMethods ?? []).map((method) => method.id));
      if (env.XAI_API_KEY?.trim() && advertised.has("xai.api_key")) {
        return { methodId: "xai.api_key", _meta: { headless: true } };
      }
      if (options.cachedAuthAvailable && advertised.has("cached_token")) {
        return { methodId: "cached_token", _meta: { headless: true } };
      }
      return undefined;
    },
    buildSessionMeta: (instructions) => ({ rules: instructions }),
    buildPrompt: (instruction) => instruction,
    isFacadeToolCall: (toolCall) => {
      const metadata = readRecord(toolCall._meta);
      const xaiTool = readRecord(metadata?.["x.ai/tool"]);
      const rawInput = readRecord(toolCall.rawInput);
      const toolName =
        readString(rawInput?.tool_name) ?? readString(toolCall.name) ?? readString(toolCall.title);
      if (!STAGEHAND_GROK_TOOL_NAMES.has(toolName ?? "")) return false;
      return (
        xaiTool?.namespace === "mcp" ||
        (xaiTool?.namespace === "grok_build" && xaiTool?.name === "use_tool")
      );
    },
  };
}

export async function createGrokRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GrokRuntime> {
  const root = await mkdtemp(join(tmpdir(), "stagehand-grok-build-"));
  const userHome = join(root, "home");
  const cwd = join(root, "workspace");
  const grokHome = join(userHome, ".grok");
  const agentProfilePath = join(grokHome, STAGEHAND_GROK_AGENT_PROFILE);
  await Promise.all([mkdir(cwd, { recursive: true }), mkdir(grokHome, { recursive: true })]);
  await Promise.all([
    writeFile(agentProfilePath, GROK_AGENT_PROFILE, { mode: 0o600 }),
    writeFile(
      join(grokHome, "config.toml"),
      [
        "[cli]",
        "auto_update = false",
        "",
        "[compat.claude]",
        "mcps = false",
        "",
        "[compat.cursor]",
        "mcps = false",
        "",
        "[subagents]",
        "enabled = false",
        "",
        "[ui]",
        'permission_mode = "ask"',
        "",
      ].join("\n"),
      { mode: 0o600 },
    ),
  ]);

  let cachedAuthAvailable = false;
  if (!env.XAI_API_KEY?.trim()) {
    const sourceHome = resolveGrokAuthHome(env);
    if (sourceHome) {
      const sourceAuth = join(sourceHome, "auth.json");
      try {
        await access(sourceAuth);
        await copyFile(sourceAuth, join(grokHome, "auth.json"));
        cachedAuthAvailable = true;
      } catch {
        // Missing cached auth is reported after ACP initialization, when Grok's
        // advertised methods are known.
      }
    }
  }
  return { root, userHome, cwd, grokHome, agentProfilePath, cachedAuthAvailable };
}

export function resolveInstruction(args: string[]): string {
  return (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
}

export async function runGrokBuild(
  instruction: string,
  options: RunGrokBuildOptions = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const runtime = await (options.makeRuntime ?? createGrokRuntime)(env);
  try {
    const agentEnv = {
      ...env,
      HOME: runtime.userHome,
      USERPROFILE: runtime.userHome,
      GROK_HOME: runtime.grokHome,
    };
    const profile = createGrokProfile({
      executable: options.grokExecutable ?? resolveGrokExecutable(),
      cachedAuthAvailable: runtime.cachedAuthAvailable,
      agentProfilePath: runtime.agentProfilePath,
    });
    return await (options.runAcp ?? runAcpFacadeAgent)({
      profile,
      instruction,
      cwd: runtime.cwd,
      env: agentEnv,
      ...(options.facadeServerPath ? { facadeServerPath: options.facadeServerPath } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } finally {
    await rm(runtime.root, { recursive: true, force: true });
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function main(): Promise<void> {
  const instruction = resolveInstruction(process.argv.slice(2));
  if (!instruction) throw new Error('Usage: pnpm start "your instruction"');
  const controller = new AbortController();
  const onSignal = () => controller.abort(new Error("Grok Build run interrupted."));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    // oxlint-disable-next-line no-console -- CLI example prints the agent result.
    console.log(await runGrokBuild(instruction, { signal: controller.signal }));
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

if (import.meta.main) {
  main().catch(handleFailure);
}

function handleFailure(error: unknown): void {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
