import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { getRepoRootDir } from "../runtimePaths.js";
import type {
  StartupProfile,
  ToolSurface,
} from "../core/contracts/tool.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";

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
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  cleanup: () => Promise<void>;
}

const BROWSE_CLI_ENTRYPOINT = path.join(
  getRepoRootDir(),
  "packages",
  "cli",
  "dist",
  "index.js",
);
const BROWSE_CLI_PACKAGE_JSON = path.join(
  getRepoRootDir(),
  "packages",
  "cli",
  "package.json",
);
const BROWSER_SKILL_SOURCE = path.join(
  getRepoRootDir(),
  "packages",
  "evals",
  "skills",
  "browser",
  "SKILL.md",
);

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
    default:
      throw new EvalsError(
        `Claude Code harness supports --tool browse_cli for execution right now; received "${toolSurface}".`,
      );
  }
}

export function resolveClaudeCodeToolSurface(
  requested?: ToolSurface,
): ToolSurface {
  if (!requested) return "browse_cli";
  if (requested === "browse_cli") return requested;
  throw new EvalsError(
    `Claude Code harness supports --tool browse_cli for execution right now; received "${requested}".`,
  );
}

export function resolveClaudeCodeStartupProfile(
  toolSurface: ToolSurface,
  environment: "LOCAL" | "BROWSERBASE",
  requested?: StartupProfile,
): StartupProfile {
  if (requested) return requested;

  if (toolSurface === "browse_cli") {
    return environment === "BROWSERBASE"
      ? "tool_create_browserbase"
      : "tool_launch_local";
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
  if (!fs.existsSync(BROWSE_CLI_ENTRYPOINT)) {
    throw new EvalsError(
      `browse_cli requires a built CLI entrypoint at ${BROWSE_CLI_ENTRYPOINT}. Run pnpm --dir packages/cli build first.`,
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
  await installBrowserSkill(cwd);
  input.logger.log({
    category: "claude_code",
    message: `Installed browser skill for Claude Code at ${path.join(cwd, ".claude", "skills", "browser", "SKILL.md")}`,
    level: 1,
  });
  const env = {
    ...process.env,
    BROWSE_SESSION: session,
    PATH: `${cwd}${path.delimiter}${process.env.PATH ?? ""}`,
  } as Record<string, string>;

  await fsp.writeFile(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(BROWSE_CLI_ENTRYPOINT)} --json --session ${JSON.stringify(session)} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  await runBrowseSetup(wrapperPath, input.environment, input.logger, env, cwd);

  return {
    toolSurface: "browse_cli",
    startupProfile: input.startupProfile,
    cwd,
    env,
    allowedTools: ["Skill", "Bash"],
    settingSources: ["project"],
    canUseTool: async (toolName, commandInput) => {
      if (toolName === "Skill") {
        return { behavior: "allow", updatedInput: commandInput };
      }
      if (toolName !== "Bash") {
        return { behavior: "deny", message: "Only Skill and Bash are allowed." };
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
    promptInstructions: buildBrowseCliPromptInstructions(input.plan),
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

async function runBrowseSetup(
  wrapperPath: string,
  environment: "LOCAL" | "BROWSERBASE",
  logger: EvalLogger,
  env: Record<string, string>,
  cwd: string,
): Promise<void> {
  await runBrowseCommand(
    wrapperPath,
    ["env", environment === "BROWSERBASE" ? "remote" : "local"],
    logger,
    env,
    cwd,
  );
}

function buildBrowseCliPromptInstructions(
  plan: ExternalHarnessTaskPlan,
): string {
  void plan;
  return [
    "Browser tool surface: browse_cli.",
    "A project skill named browser is available. Use the Skill tool to load it before using browse.",
    "Use Bash only to run the browse command. It is already on PATH and pinned to this eval session.",
    "Do not use network/web tools outside browse. Do not edit repository files.",
    "The benchmark start URL is provided above.",
  ].join("\n");
}

export async function installBrowserSkill(cwd: string): Promise<void> {
  const targetDir = path.join(cwd, ".claude", "skills", "browser");
  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.copyFile(BROWSER_SKILL_SOURCE, path.join(targetDir, "SKILL.md"));
}

export function isAllowedBrowseCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed !== "browse" && !trimmed.startsWith("browse ")) return false;
  return !/[;&|`$<>]/.test(trimmed);
}

function readCommand(input: Record<string, unknown>): string {
  const command = input.command ?? input.cmd;
  return typeof command === "string" ? command : "";
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
