import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod/v4";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import {
  BROWSE_CLI_BUILD_ARTIFACTS,
  BROWSE_CLI_ENTRYPOINT,
  BROWSE_CLI_PACKAGE_JSON,
  BROWSE_SKILL_SOURCE,
} from "../browseCliPaths.js";
import {
  AGENT_RUN_TOOL_NAME,
  AGENT_RUN_TOOL_SERVER,
  type AgentRunToolSpec,
  type StartupProfile,
  type ToolSurface,
} from "../core/contracts/tool.js";
import type { ProbeEvidence } from "stagehand-v3";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";

export { waitForCdpEvent } from "../core/tools/cdp_code.js";

export interface ClaudeCodeToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

export interface PreparedClaudeCodeToolAdapter {
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  allowedTools: string[];
  settingSources: string[];
  promptInstructions: string;
  mcpServers?: Record<string, unknown>;
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  /** Best-effort evidence from the currently running tool surface. */
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  /**
   * Runner calls this on every completed tool_result with the originating
   * tool name; MCP-mounted surfaces use it to record per-step observations
   * (their tool calls never pass through harness code).
   */
  onToolResult?: (toolName: string) => void;
  /** Which tool names consume observation indexes in the trajectory adapter. */
  observedToolMatcher?: (toolName: string) => boolean;
  cleanup: () => Promise<void>;
}

export interface PreparedBrowseCliHarnessAdapter {
  toolSurface: "browse_cli";
  startupProfile: StartupProfile;
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  metadata: BrowseCliToolMetadata;
  cleanup: () => Promise<void>;
}

export interface BrowseCliHarnessAdapterInput {
  startupProfile: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  logCategory: string;
}

export const CLAUDE_CODE_TOOL_SURFACES: ToolSurface[] = [
  "browse_cli",
  "playwright_code",
  "cdp_code",
  "stagehand_code",
  "playwright_mcp",
  "chrome_devtools_mcp",
  "stagehand_facade",
];

// The CLI skill below is written for interactive use and covers surface
// (install, Browse.sh discovery, Browserbase cloud/Functions/templates) that
// does not apply inside the eval harness. This addendum is inserted right
// after the CLI skill's frontmatter — before the model reads any of the
// conflicting examples in the body — at install time, so the harness ships
// one source of truth (the real, maintained browse skill) instead of a
// second copy that drifts.
const EVAL_HARNESS_ADDENDUM = `
## Eval Harness Addendum

This skill is installed by the Stagehand eval harness, which overrides some of
the guidance below:

- \`browse\` is already installed and pinned by the harness to this eval's
  session and environment. Never run \`npm install -g browse\` or otherwise
  install/upgrade it. Never pass \`--local\`, \`--remote\`, or \`--session\` —
  the harness's wrapper appends the correct environment and session flags to
  every command automatically.
- Run exactly one \`browse ...\` command per Bash tool call. Shell operators
  (\`|\`, \`&&\`, \`;\`, backticks, \`$()\`, and redirection) are rejected by the
  harness, so chained or piped commands will fail.
- Ignore the sections below about installing \`browse\`, Browse.sh skill
  discovery/installation (\`browse skills ...\`), Browserbase cloud/session/
  context/extension management (\`browse cloud ...\`), Functions
  (\`browse functions ...\`), and Templates (\`browse templates ...\`) — all out
  of scope during evals. Do not run those commands even though they are
  documented below.
- Do not edit repository files. Do not use network or web tools other than
  \`browse\`.
- When finished, report the result in the exact \`EVAL_RESULT\` format
  requested by the harness prompt.
`;
const ALLOW_UNSANDBOXED_LOCAL_ENV = "EVAL_CLAUDE_CODE_ALLOW_UNSANDBOXED_LOCAL";
const RUN_TOOL_SERVER = AGENT_RUN_TOOL_SERVER;
const RUN_TOOL_NAME = AGENT_RUN_TOOL_NAME;

type ClaudeToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type SdkToolFactory = (
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  handler: (args: { code: string }) => Promise<ClaudeToolResult>,
  extras?: Record<string, unknown>,
) => unknown;

type SdkMcpServerFactory = (options: {
  name: string;
  version?: string;
  tools?: unknown[];
  alwaysLoad?: boolean;
}) => unknown;

export interface BrowseCliToolMetadata {
  toolCommand: "browse";
  browseCliEntrypoint: string;
  browseCliVersion?: string;
}

export function getBrowseCliToolMetadata(): BrowseCliToolMetadata {
  return {
    toolCommand: "browse",
    browseCliEntrypoint: BROWSE_CLI_ENTRYPOINT,
    ...readBrowseCliVersion(),
  };
}

export function allowUnsandboxedLocalClaudeCode(): boolean {
  return process.env[ALLOW_UNSANDBOXED_LOCAL_ENV] === "true";
}

export function getBrowseCliAllowedTools(): string[] {
  return allowUnsandboxedLocalClaudeCode() ? ["Skill", "Bash"] : ["Skill"];
}

export async function prepareClaudeCodeToolAdapter(
  input: ClaudeCodeToolAdapterInput,
): Promise<PreparedClaudeCodeToolAdapter> {
  const toolSurface = resolveToolSurface(
    { harness: "claude_code", supportedToolSurfaces: CLAUDE_CODE_TOOL_SURFACES },
    input.toolSurface,
  );
  if (toolSurface === undefined) {
    throw new EvalsError("Claude Code harness requires a tool surface.");
  }
  const startupProfile = resolveStartupProfile(
    toolSurface,
    input.environment,
    input.startupProfile,
  );

  switch (toolSurface) {
    case "browse_cli":
      return prepareBrowseCliAdapter({
        ...input,
        toolSurface,
        startupProfile,
      });
    case "playwright_code":
    case "cdp_code":
    case "stagehand_code":
    case "playwright_mcp":
    case "chrome_devtools_mcp":
    case "stagehand_facade": {
      return prepareMountedCoreToolAdapter({
        ...input,
        toolSurface,
        startupProfile,
      });
    }
    default:
      throw new EvalsError(`Unsupported Claude Code tool surface "${toolSurface}".`);
  }
}

async function prepareBrowseCliAdapter(
  input: ClaudeCodeToolAdapterInput & {
    toolSurface: "browse_cli";
    startupProfile: StartupProfile;
  },
): Promise<PreparedClaudeCodeToolAdapter> {
  const adapter = await prepareBrowseCliHarnessAdapter({
    startupProfile: input.startupProfile,
    environment: input.environment,
    plan: input.plan,
    logger: input.logger,
    logCategory: "claude_code",
  });

  if (allowUnsandboxedLocalClaudeCode()) {
    input.logger.warn({
      category: "claude_code",
      message: `${ALLOW_UNSANDBOXED_LOCAL_ENV}=true: raw Bash auto-approval is enabled for Claude Code. Use only in an isolated checkout/container.`,
      level: 0,
    });
  }

  return {
    ...adapter,
    allowedTools: getBrowseCliAllowedTools(),
    settingSources: ["project"],
    canUseTool: async (toolName, commandInput) => {
      if (toolName === "Skill") {
        return { behavior: "allow", updatedInput: commandInput };
      }
      if (toolName !== "Bash") {
        return {
          behavior: "deny",
          message: "Only Skill and Bash are allowed.",
        };
      }

      const command = readCommand(commandInput);
      if (!isAllowedBrowseCommand(command)) {
        return {
          behavior: "deny",
          message: "Only browse commands are allowed for this eval harness.",
        };
      }

      return { behavior: "allow", updatedInput: commandInput };
    },
  };
}

export async function prepareBrowseCliHarnessAdapter(
  input: BrowseCliHarnessAdapterInput,
): Promise<PreparedBrowseCliHarnessAdapter> {
  const missingArtifact = BROWSE_CLI_BUILD_ARTIFACTS.find((artifact) => !fs.existsSync(artifact));
  if (missingArtifact) {
    throw new EvalsError(
      `browse_cli requires built CLI artifacts; missing ${missingArtifact}. Run pnpm --dir packages/cli build first.`,
    );
  }

  if (
    (input.environment === "LOCAL" && input.startupProfile !== "tool_launch_local") ||
    (input.environment === "BROWSERBASE" && input.startupProfile !== "tool_create_browserbase")
  ) {
    throw new EvalsError(
      `browse_cli startup profile "${input.startupProfile}" is not valid for environment "${input.environment}".`,
    );
  }

  const session = createBrowseSessionName();
  const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "stagehand-evals-claude-browse-"));
  const wrapperPath = path.join(cwd, "browse");
  await installBrowseSkill(cwd);
  input.logger.log({
    category: input.logCategory,
    message: `Installed browse skill at ${path.join(cwd, ".claude", "skills", "browse", "SKILL.md")}`,
    level: 1,
  });
  const env = {
    ...process.env,
    BROWSE_SESSION: session,
    PATH: `${cwd}${path.delimiter}${process.env.PATH ?? ""}`,
  } as Record<string, string>;

  const modeFlag = input.environment === "BROWSERBASE" ? "--remote" : "--local";
  await fsp.writeFile(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      // The mode flag (--local/--remote) selects the environment when the daemon
      // is first started and must be explicit so a set BROWSERBASE_API_KEY does
      // not silently auto-select remote. It is only accepted by the driver
      // commands, so skip it for the few subcommands that reject it (stop,
      // status). The session name is safe on every command.
      "cmd=${1:-}",
      "mode=()",
      'if [[ "$cmd" != "stop" && "$cmd" != "status" ]]; then',
      `  mode=(${JSON.stringify(modeFlag)})`,
      "fi",
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(BROWSE_CLI_ENTRYPOINT)} "$@" "\${mode[@]+\${mode[@]}}" --session ${JSON.stringify(session)}`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  return {
    toolSurface: "browse_cli",
    startupProfile: input.startupProfile,
    cwd,
    env,
    promptInstructions: buildBrowseCliPromptInstructions(input.plan),
    metadata: getBrowseCliToolMetadata(),
    cleanup: async () => {
      await runBrowseCommand(wrapperPath, ["stop", "--force"], input.logger, env, cwd).catch(
        (): undefined => undefined,
      );
      await fsp.rm(cwd, { recursive: true, force: true });
    },
  };
}

/**
 * Starts a CoreTool once and mounts the returned agent binding. The harness
 * switches only on the binding modality, never on the tool surface identity.
 */
async function prepareMountedCoreToolAdapter(
  input: ClaudeCodeToolAdapterInput & {
    toolSurface: ToolSurface;
    startupProfile: StartupProfile;
  },
): Promise<PreparedClaudeCodeToolAdapter> {
  const runtime = await startAgentToolRuntime(input);
  try {
    return await prepareAgentMountAdapter(runtime.running, runtime.cleanup, input);
  } catch (error) {
    // Same bound as normal teardown — a hung cleanup must not wedge the row
    // on the setup-failure path either.
    await withTimeout(
      runtime.cleanup(),
      readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
    ).catch((): undefined => undefined);
    throw error;
  }
}

/**
 * The generic mount point for handle bindings: wraps the binding's handles in
 * the harness's MCP "run" tool, whose executor runs
 * snippet code in an AsyncFunction scope over the handle names plus
 * startUrl, task, and console. Surface specifics (handles, prompt
 * instructions, run-tool copy, snippet task/console bindings, cleanup) all
 * come from the mount — this function owns only harness mechanics.
 */
async function prepareAgentMountAdapter(
  running: Awaited<ReturnType<typeof startAgentToolRuntime>>["running"],
  cleanupRuntime: () => Promise<void>,
  input: ClaudeCodeToolAdapterInput & {
    toolSurface: ToolSurface;
    startupProfile: StartupProfile;
  },
): Promise<PreparedClaudeCodeToolAdapter> {
  let cwd: string | undefined;
  try {
    const mount = running.agentMount;
    if (!mount) {
      throw new EvalsError(`Tool surface "${input.toolSurface}" does not provide an agent mount.`);
    }
    if (mount.via !== "handles" && mount.via !== "mcp") {
      throw new EvalsError(
        `Claude Code does not support agent mounts delivered via "${mount.via}" yet.`,
      );
    }
    const handlesMount = mount.via === "handles" ? mount : undefined;
    const mcpMount = mount.via === "mcp" ? mount : undefined;

    cwd = await fsp.mkdtemp(path.join(os.tmpdir(), `stagehand-evals-claude-${input.toolSurface}-`));
    const cleanupCwd = cwd;
    const env = { ...process.env } as Record<string, string>;
    const recorder = running.captureEvidence
      ? new ObservationRecorder(running.captureEvidence)
      : undefined;
    // handles mounts wrap the surface in the harness's run tool (which owns
    // per-step observation); mcp mounts pass the agent's own server spec
    // through, and observation is triggered from the runner's tool_result
    // stream instead.
    const mcpServers = handlesMount
      ? await buildCodeExposureRunMcpServers({
          handles: handlesMount.handles,
          runToolSpec: handlesMount.runTool,
          plan: input.plan,
          logger: input.logger,
          recordObservation: recorder ? () => recorder.record() : undefined,
        })
      : mcpMount!.mcpServers;
    // "mcp__<server>" allows every tool the named server exposes.
    const mcpToolPrefixes = mcpMount
      ? Object.keys(mcpMount.mcpServers).map((name) => `mcp__${name}`)
      : [];
    const isMountToolName = (toolName: string): boolean =>
      handlesMount
        ? toolName === RUN_TOOL_NAME
        : mcpToolPrefixes.some(
            (prefix) => toolName === prefix || toolName.startsWith(`${prefix}__`),
          );
    let cleanupPromise: Promise<void> | undefined;

    return {
      toolSurface: input.toolSurface,
      startupProfile: input.startupProfile,
      cwd,
      env,
      allowedTools: ["Bash", ...(handlesMount ? [RUN_TOOL_NAME] : mcpToolPrefixes)],
      settingSources: [],
      mcpServers,
      canUseTool: async (toolName, commandInput) => {
        if (toolName === "Bash" || isMountToolName(toolName)) {
          return { behavior: "allow", updatedInput: commandInput };
        }
        return {
          behavior: "deny",
          message:
            handlesMount?.runTool.denyMessage ??
            `Only Bash and the ${mcpToolPrefixes.join(", ")} tools are allowed.`,
        };
      },
      ...(mcpMount &&
        recorder && {
          onToolResult: (toolName: string) => {
            if (isMountToolName(toolName)) void recorder.record();
          },
          observedToolMatcher: isMountToolName,
        }),
      promptInstructions: mount.promptInstructions,
      ...(running.captureEvidence && {
        captureEvidence: async (): Promise<ProbeEvidence> => {
          try {
            return await withTimeout(
              running.captureEvidence!(),
              readPositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000),
            );
          } catch {
            return {};
          }
        },
      }),
      ...(recorder && {
        drainStepObservations: async () => {
          await recorder.settle();
          return recorder.drain();
        },
      }),
      cleanup: async () => {
        cleanupPromise ??= (async () => {
          try {
            await withTimeout(
              cleanupRuntime(),
              readPositiveIntEnv("EVAL_AGENT_MOUNT_CLEANUP_TIMEOUT_MS", 30_000),
            );
          } catch {
            // Cleanup is best-effort, but temp-dir cleanup must run.
          } finally {
            await fsp.rm(cleanupCwd, { recursive: true, force: true });
          }
        })();
        await cleanupPromise;
      },
    };
  } catch (error) {
    if (cwd) {
      await fsp.rm(cwd, { recursive: true, force: true });
    }
    throw error;
  }
}

async function buildCodeExposureRunMcpServers(input: {
  handles: Record<string, unknown>;
  runToolSpec: AgentRunToolSpec;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  recordObservation?: () => Promise<void>;
}): Promise<Record<string, unknown>> {
  const sdk = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as {
    createSdkMcpServer: SdkMcpServerFactory;
    tool: SdkToolFactory;
  };

  const runTool = sdk.tool(
    "run",
    input.runToolSpec.description,
    {
      code: z.string().describe(input.runToolSpec.codeParamDescription),
    },
    async ({ code }) => {
      const result = await executeCodeExposureRunTool({
        code,
        handles: input.handles,
        runToolSpec: input.runToolSpec,
        plan: input.plan,
        logger: input.logger,
      });
      await input.recordObservation?.();
      return result;
    },
    { alwaysLoad: true },
  );

  return {
    [RUN_TOOL_SERVER]: sdk.createSdkMcpServer({
      name: RUN_TOOL_SERVER,
      version: "1.0.0",
      tools: [runTool],
      alwaysLoad: true,
    }),
  };
}

async function executeCodeExposureRunTool(input: {
  code: string;
  handles: Record<string, unknown>;
  runToolSpec: AgentRunToolSpec;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<ClaudeToolResult> {
  try {
    const result = await withTimeout(
      executeCodeExposureSnippet(input),
      readPositiveIntEnv("EVAL_CLAUDE_CODE_RUN_TOOL_TIMEOUT_MS", 60_000),
    );
    const text = stringifyToolResult(result);
    input.logger.log({
      category: "claude_code",
      message: `run tool completed: ${clip(text, 500)}`,
      level: 1,
    });
    return {
      content: [{ type: "text", text }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn({
      category: "claude_code",
      message: `run tool failed: ${message}`,
      level: 1,
    });
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
}

async function executeCodeExposureSnippet(input: {
  code: string;
  handles: Record<string, unknown>;
  runToolSpec: AgentRunToolSpec;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  // Snippet scope = the exposure's handle names plus startUrl/task/console.
  // Object.keys/Object.values over the same object are guaranteed to align,
  // so names — not positions — bind the values.
  const fn = new AsyncFunction(
    ...Object.keys(input.handles),
    "startUrl",
    "task",
    "console",
    input.code,
  );
  return fn(
    ...Object.values(input.handles),
    input.plan.startUrl,
    {
      dataset: input.plan.dataset,
      id: input.plan.taskId,
      startUrl: input.plan.startUrl,
      instruction: input.plan.instruction,
    },
    buildRunToolConsole(input.logger),
  );
}

function buildRunToolConsole(logger: EvalLogger): Pick<Console, "log" | "warn" | "error"> {
  const write = (level: "log" | "warn" | "error", values: unknown[]) => {
    logger.log({
      category: "claude_code",
      message: `run console.${level}: ${values.map(stringifyToolResult).join(" ")}`,
      level: 1,
    });
  };
  return {
    log: (...values: unknown[]) => write("log", values),
    warn: (...values: unknown[]) => write("warn", values),
    error: (...values: unknown[]) => write("error", values),
  };
}

function buildBrowseCliPromptInstructions(plan: ExternalHarnessTaskPlan): string {
  void plan;
  return [
    "Browser tool surface: browse_cli.",
    "A project skill named browse is available. Use the Skill tool to load it before using browse.",
    "Use Bash only to run the browse command. It is already on PATH and pinned to this eval session.",
    "Do not use network/web tools outside browse. Do not edit repository files.",
    "The benchmark start URL is provided above.",
  ].join("\n");
}

export async function installBrowseSkill(cwd: string): Promise<void> {
  const targetDir = path.join(cwd, ".claude", "skills", "browse");
  await fsp.mkdir(targetDir, { recursive: true });
  const cliSkill = await fsp.readFile(BROWSE_SKILL_SOURCE, "utf8");
  await fsp.writeFile(
    path.join(targetDir, "SKILL.md"),
    insertAfterFrontmatter(cliSkill, EVAL_HARNESS_ADDENDUM),
  );
}

// Inserts `addition` immediately after the skill's YAML frontmatter (so
// frontmatter parsing is unaffected) and before the rest of the body, so the
// eval-harness rules are the first thing the model reads rather than a
// caveat appended after conflicting examples.
//
// Frontmatter *boundary detection* is delegated to gray-matter rather than a
// hand-rolled regex: the regex here already needed a CRLF patch and still
// fails silently on BOM-prefixed files or a `---` line embedded inside a
// YAML multiline string, corrupting the installed skill by prepending the
// addendum before the frontmatter instead of after it.
//
// We deliberately do NOT use `matter.stringify()` to rebuild the file: it
// re-serializes the parsed data through js-yaml, which can reformat the
// frontmatter (e.g. collapsing/re-wrapping a folded `description: >` block)
// and would silently rewrite the shipped skill on every install. Instead we
// only use gray-matter to find the frontmatter/body boundary, then
// reassemble from the ORIGINAL raw string so the frontmatter block that
// ships is byte-identical to the frontmatter block in the source file.
export function insertAfterFrontmatter(markdown: string, addition: string): string {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(markdown);
  } catch {
    // Unterminated/invalid YAML frontmatter -- fall back to the same
    // no-frontmatter behavior below instead of throwing during skill
    // install.
    return `${addition}\n${markdown}`;
  }

  // gray-matter never rebuilds the body string -- `parsed.content` is
  // always a raw suffix of `markdown` (it locates the frontmatter block and
  // slices it off). That makes `markdown.length - parsed.content.length`
  // the exact length, in the original source bytes, of everything before
  // the body: any leading BOM, the delimiters, and the source's own line
  // endings -- all preserved as-is. We don't rely on `parsed.matter` for
  // this, since it strips delimiters and can normalize newlines. When there
  // is no frontmatter, gray-matter returns `content` unchanged, so this
  // offset is 0.
  const frontmatterLength = markdown.length - parsed.content.length;
  if (frontmatterLength <= 0) return `${addition}\n${markdown}`;

  const frontmatter = markdown.slice(0, frontmatterLength);
  const body = parsed.content;
  return `${frontmatter}${addition}\n${body}`;
}

export function isAllowedBrowseCommand(command: string): boolean {
  const trimmed = command.trim();
  if (/[\r\n]/.test(trimmed)) return false;
  if (trimmed !== "browse" && !trimmed.startsWith("browse ")) return false;
  return !/[;&|`$<>]/.test(trimmed);
}

function readCommand(input: Record<string, unknown>): string {
  const command = input.command ?? input.cmd;
  return typeof command === "string" ? command : "";
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`run tool timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function stringifyToolResult(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function createBrowseSessionName(): string {
  return `evals-claude-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runBrowseCommand(
  wrapperPath: string,
  args: string[],
  logger: EvalLogger,
  env: Record<string, string>,
  cwd: string,
): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(wrapperPath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      logger.log({ category: "browse_cli", message: chunk, level: 1 });
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      logger.log({ category: "browse_cli", message: chunk, level: 1 });
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new EvalsError(`browse_cli command failed (${args.join(" ")}): ${stderr.trim()}`));
    });
  });
}

function readBrowseCliVersion(): { browseCliVersion?: string } {
  try {
    const parsed = JSON.parse(fs.readFileSync(BROWSE_CLI_PACKAGE_JSON, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? { browseCliVersion: parsed.version } : {};
  } catch {
    return {};
  }
}
