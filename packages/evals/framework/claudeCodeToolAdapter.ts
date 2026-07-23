import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod/v4";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { getRepoRootDir } from "../runtimePaths.js";
import {
  LLM_RUN_TOOL_NAME,
  LLM_RUN_TOOL_SERVER,
  type LLMExposure,
  type LLMRunToolSpec,
  type TerminalArtifact,
  type StartupProfile,
  type ToolSurface,
} from "../core/contracts/tool.js";
import { prepareLLMExposure as prepareCdpCodeLLMExposure } from "../core/tools/cdp_code.js";
import { prepareLLMExposure as preparePlaywrightCodeLLMExposure } from "../core/tools/playwright_code.js";
import { prepareLLMExposure as prepareV4CodeLLMExposure } from "../core/tools/v4_code.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";

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
  /**
   * Harness-observed terminal state for artifact-grounded grading (bounded;
   * best-effort). Present when the surface's exposure implements it.
   */
  captureFinalState?: () => Promise<TerminalArtifact>;
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

const BROWSE_CLI_ENTRYPOINT = path.join(
  getRepoRootDir(),
  "packages",
  "cli",
  "bin",
  "run.js",
);
const BROWSE_CLI_BUILD_ARTIFACTS = [
  path.join(getRepoRootDir(), "packages", "cli", "oclif.manifest.json"),
  path.join(getRepoRootDir(), "packages", "cli", "dist", "commands", "open.js"),
];
const BROWSE_CLI_PACKAGE_JSON = path.join(
  getRepoRootDir(),
  "packages",
  "cli",
  "package.json",
);
const BROWSE_SKILL_SOURCE = path.join(
  getRepoRootDir(),
  "packages",
  "cli",
  "skills",
  "browse",
  "SKILL.md",
);
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
const RUN_TOOL_SERVER = LLM_RUN_TOOL_SERVER;
const RUN_TOOL_NAME = LLM_RUN_TOOL_NAME;

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
  const toolSurface = resolveClaudeCodeToolSurface(input.toolSurface);
  const startupProfile = resolveClaudeCodeStartupProfile(
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
    case "cdp_code": {
      const prepareSurfaceExposure =
        toolSurface === "playwright_code"
          ? preparePlaywrightCodeLLMExposure
          : prepareCdpCodeLLMExposure;
      const exposure = await prepareSurfaceExposure(
        input.plan,
        input.environment,
        input.logger,
        startupProfile,
      );
      return prepareCodeExposureAdapter(exposure, {
        ...input,
        toolSurface,
        startupProfile,
      });
    }
    case "v4_code":
    case "v4_code_deterministic": {
      // v4_code = AI mode (stagehand.act/observe/extract in scope);
      // v4_code_deterministic = no-LLM mode. LOCAL runs go through the
      // isolated forked-child controller; BROWSERBASE (AI only) stays
      // in-process. See core/tools/v4_code.ts.
      const mode =
        toolSurface === "v4_code_deterministic" ? "deterministic" : "ai";
      const exposure = await prepareV4CodeLLMExposure(
        input.plan,
        input.environment,
        input.logger,
        startupProfile,
        mode,
      );
      return prepareCodeExposureAdapter(exposure, {
        ...input,
        toolSurface,
        startupProfile,
      });
    }
    default:
      throw new EvalsError(
        `Claude Code harness supports --tool browse_cli, playwright_code, cdp_code, v4_code, or v4_code_deterministic for execution right now; received "${toolSurface}".`,
      );
  }
}

export function resolveClaudeCodeToolSurface(
  requested?: ToolSurface,
): ToolSurface {
  if (!requested) return "browse_cli";
  if (
    requested === "browse_cli" ||
    requested === "playwright_code" ||
    requested === "cdp_code" ||
    requested === "v4_code" ||
    requested === "v4_code_deterministic"
  ) {
    return requested;
  }
  throw new EvalsError(
    `Claude Code harness supports --tool browse_cli, playwright_code, cdp_code, v4_code, or v4_code_deterministic for execution right now; received "${requested}".`,
  );
}

export function resolveClaudeCodeStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  if (requested) return requested;

  // browse_cli and the v4_code surfaces own their browser (the v4 SDK launches
  // or creates it via the extension stack), so no runner-provided CDP endpoint.
  if (
    toolSurface === "browse_cli" ||
    toolSurface === "v4_code" ||
    toolSurface === "v4_code_deterministic"
  ) {
    return environment === "BROWSERBASE"
      ? "tool_create_browserbase"
      : "tool_launch_local";
  }
  if (toolSurface === "playwright_code" || toolSurface === "cdp_code") {
    return environment === "BROWSERBASE"
      ? "runner_provided_browserbase_cdp"
      : "runner_provided_local_cdp";
  }

  throw new EvalsError(
    `No Claude Code startup profile default for tool "${toolSurface}" in ${environment}.`,
  );
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
  const missingArtifact = BROWSE_CLI_BUILD_ARTIFACTS.find(
    (artifact) => !fs.existsSync(artifact),
  );
  if (missingArtifact) {
    throw new EvalsError(
      `browse_cli requires built CLI artifacts; missing ${missingArtifact}. Run pnpm --dir packages/cli build first.`,
    );
  }

  if (
    (input.environment === "LOCAL" &&
      input.startupProfile !== "tool_launch_local") ||
    (input.environment === "BROWSERBASE" &&
      input.startupProfile !== "tool_create_browserbase")
  ) {
    throw new EvalsError(
      `browse_cli startup profile "${input.startupProfile}" is not valid for environment "${input.environment}".`,
    );
  }

  const session = createBrowseSessionName();
  const cwd = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-claude-browse-"),
  );
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
      await runBrowseCommand(
        wrapperPath,
        ["stop", "--force"],
        input.logger,
        env,
        cwd,
      ).catch((): undefined => undefined);
      await fsp.rm(cwd, { recursive: true, force: true });
    },
  };
}

/**
 * Per-surface temp working directories keep the same names as the old
 * per-surface adapters so operators can keep telling run dirs apart.
 */
const CODE_EXPOSURE_TMPDIR_SUFFIXES: Partial<Record<ToolSurface, string>> = {
  v4_code: "v4",
  v4_code_deterministic: "v4-det",
  playwright_code: "playwright",
  cdp_code: "cdp",
};

/**
 * The single generic mount point for `code_handles` exposures: wraps the
 * exposure's handles in the harness's MCP "run" tool, whose executor runs
 * snippet code in an AsyncFunction scope over the handle names plus
 * startUrl, task, and console. Surface specifics (handles, prompt
 * instructions, run-tool copy, snippet task/console bindings, cleanup) all
 * come from the exposure — this function owns only harness mechanics.
 */
async function prepareCodeExposureAdapter(
  exposure: LLMExposure,
  input: ClaudeCodeToolAdapterInput & {
    toolSurface: ToolSurface;
    startupProfile: StartupProfile;
  },
): Promise<PreparedClaudeCodeToolAdapter> {
  let cwd: string | undefined;
  try {
    // A code_handles exposure is mounted one of two ways: in-process (the
    // harness builds an AsyncFunction over `handles`) or out-of-process (the
    // exposure supplies `executeSnippet`, e.g. a forked child that isolates a
    // browser-launching SDK). Exactly one must be present.
    if (
      exposure.kind !== "code_handles" ||
      (!exposure.handles && !exposure.executeSnippet)
    ) {
      throw new EvalsError(
        `Claude Code run-tool mounting requires a code_handles exposure with either handles or executeSnippet; "${input.toolSurface}" returned kind "${exposure.kind}".`,
      );
    }
    const runToolSpec = exposure.runTool;
    if (!runToolSpec) {
      throw new EvalsError(
        `Claude Code run-tool mounting requires the exposure's runTool spec; "${input.toolSurface}" did not provide one.`,
      );
    }

    const suffix =
      CODE_EXPOSURE_TMPDIR_SUFFIXES[input.toolSurface] ?? input.toolSurface;
    cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), `stagehand-evals-claude-${suffix}-`),
    );
    const cleanupCwd = cwd;
    const env = { ...process.env } as Record<string, string>;
    const mcpServers = await buildCodeExposureRunMcpServers({
      handles: exposure.handles ?? {},
      executeSnippet: exposure.executeSnippet,
      runToolSpec,
      plan: input.plan,
      logger: input.logger,
    });

    return {
      toolSurface: input.toolSurface,
      startupProfile: input.startupProfile,
      cwd,
      env,
      allowedTools: ["Bash", RUN_TOOL_NAME],
      settingSources: [],
      mcpServers,
      canUseTool: async (toolName, commandInput) => {
        if (toolName === RUN_TOOL_NAME || toolName === "Bash") {
          return { behavior: "allow", updatedInput: commandInput };
        }
        return {
          behavior: "deny",
          message: runToolSpec.denyMessage,
        };
      },
      promptInstructions: exposure.promptInstructions,
      ...(exposure.captureFinalState && {
        captureFinalState: async (): Promise<TerminalArtifact> => {
          try {
            return await withTimeout(
              exposure.captureFinalState!(),
              readPositiveIntEnv("EVAL_FINAL_STATE_TIMEOUT_MS", 15_000),
            );
          } catch {
            return {};
          }
        },
      }),
      cleanup: async () => {
        // Bounded (PR b327a4dc parity): a hung surface close must not wedge
        // the row — the tmpdir removal below always runs.
        try {
          await withTimeout(
            exposure.cleanup(),
            readPositiveIntEnv("EVAL_EXPOSURE_CLEANUP_TIMEOUT_MS", 30_000),
          );
        } catch {
          // best-effort only
        }
        await fsp.rm(cleanupCwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await exposure.cleanup().catch((): undefined => undefined);
    if (cwd) {
      await fsp.rm(cwd, { recursive: true, force: true });
    }
    throw error;
  }
}

async function buildCodeExposureRunMcpServers(input: {
  handles: Record<string, unknown>;
  executeSnippet?: LLMExposure["executeSnippet"];
  runToolSpec: LLMRunToolSpec;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
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
      return executeCodeExposureRunTool({
        code,
        handles: input.handles,
        executeSnippet: input.executeSnippet,
        runToolSpec: input.runToolSpec,
        plan: input.plan,
        logger: input.logger,
      });
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
  executeSnippet?: LLMExposure["executeSnippet"];
  runToolSpec: LLMRunToolSpec;
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

export async function executeCodeExposureSnippet(input: {
  code: string;
  handles: Record<string, unknown>;
  executeSnippet?: LLMExposure["executeSnippet"];
  runToolSpec: LLMRunToolSpec;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<unknown> {
  // Out-of-process surface: the exposure owns the snippet scope (e.g. a forked
  // child), so hand it the raw code plus startUrl/task. Console flows back
  // through the surface's own transport, not the in-process binding below.
  if (input.executeSnippet) {
    return input.executeSnippet({
      code: input.code,
      startUrl: input.plan.startUrl,
      task: input.runToolSpec.task,
    });
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as new (
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
    input.runToolSpec.task,
    input.runToolSpec.console ?? buildRunToolConsole(input.logger),
  );
}

function buildRunToolConsole(
  logger: EvalLogger,
): Pick<Console, "log" | "warn" | "error"> {
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

function buildBrowseCliPromptInstructions(
  plan: ExternalHarnessTaskPlan,
): string {
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
export function insertAfterFrontmatter(
  markdown: string,
  addition: string,
): string {
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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
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
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
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
      reject(
        new EvalsError(
          `browse_cli command failed (${args.join(" ")}): ${stderr.trim()}`,
        ),
      );
    });
  });
}

function readBrowseCliVersion(): { browseCliVersion?: string } {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(BROWSE_CLI_PACKAGE_JSON, "utf8"),
    ) as { version?: unknown };
    return typeof parsed.version === "string"
      ? { browseCliVersion: parsed.version }
      : {};
  } catch {
    return {};
  }
}
