import fs from "node:fs";
import type {
  AgentHarnessOptions,
  AgentHarnessRunResult,
  AgentRunInput,
  NamedStdioLaunchConfig,
} from "../../types.js";
import {
  CommandExecutionError,
  MultiagentError,
} from "../../utils/errors.js";
import { runCommand } from "../../utils/process.js";
import { BaseHarness } from "./base.js";

export type OpencodeEvent =
  | { type: "step_start"; sessionID?: string }
  | {
      type: "text";
      sessionID?: string;
      part?: { text?: string };
    }
  | {
      type: "step_finish";
      sessionID?: string;
      part?: {
        cost?: number;
        tokens?: {
          input?: number;
          output?: number;
          reasoning?: number;
          cache?: {
            read?: number;
            write?: number;
          };
        };
      };
    }
  | {
      type: "error";
      sessionID?: string;
      error?: {
        name?: string;
        data?: {
          message?: string;
        };
        message?: string;
      };
    };

function getOpencodePlatformPrefix(
  platform: string = process.platform,
  arch: string = process.arch,
): string | null {
  const platformName =
    platform === "darwin"
      ? "darwin"
      : platform === "linux"
        ? "linux"
        : platform === "win32"
          ? "windows"
          : null;
  const archName =
    arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : arch === "arm" ? "arm" : null;

  if (!platformName || !archName) {
    return null;
  }

  return `opencode-${platformName}-${archName}`;
}

function getHomebrewCellars(): string[] {
  return [
    "/opt/homebrew/Cellar/opencode",
    "/usr/local/Cellar/opencode",
    "/home/linuxbrew/.linuxbrew/Cellar/opencode",
  ];
}

export function resolveOpencodeBinaryPath(runtime?: {
  env?: NodeJS.ProcessEnv;
  existsSync?: typeof fs.existsSync;
  readdirSync?: typeof fs.readdirSync;
  platform?: string;
  arch?: string;
}): string {
  const env = runtime?.env ?? process.env;
  const existsSync = runtime?.existsSync ?? fs.existsSync;
  const readdirSync = runtime?.readdirSync ?? fs.readdirSync;

  const envOverride =
    env.MULTIAGENT_OPENCODE_BIN ?? env.OPENCODE_BIN_PATH;
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
  }

  const packagePrefix = getOpencodePlatformPrefix(
    runtime?.platform,
    runtime?.arch,
  );
  if (packagePrefix) {
    for (const cellar of getHomebrewCellars()) {
      if (!existsSync(cellar)) {
        continue;
      }

      const versions = readdirSync(cellar).sort().reverse();
      for (const version of versions) {
        const modulesDir = `${cellar}/${version}/libexec/lib/node_modules/opencode-ai/node_modules`;
        if (!existsSync(modulesDir)) {
          continue;
        }

        const packageDirs = readdirSync(modulesDir)
          .filter((entry) => entry.startsWith(packagePrefix))
          .sort((left, right) => {
            const leftPenalty = left.includes("baseline") ? 1 : 0;
            const rightPenalty = right.includes("baseline") ? 1 : 0;
            return leftPenalty - rightPenalty;
          });

        for (const packageDir of packageDirs) {
          const binaryPath = `${modulesDir}/${packageDir}/bin/opencode`;
          if (existsSync(binaryPath)) {
            return binaryPath;
          }
        }
      }
    }
  }

  return "opencode";
}

export function buildOpencodeConfig(
  mcpServers: NamedStdioLaunchConfig[],
): Record<string, unknown> {
  return {
    mcp: Object.fromEntries(
      mcpServers.map((server) => [
        server.name,
        {
          type: "local",
          enabled: true,
          command: [
            server.config.command,
            ...(server.config.args ?? []),
          ],
          environment: server.config.env ?? {},
        },
      ]),
    ),
  };
}

export function parseOpencodeJsonl(stdout: string): AgentHarnessRunResult {
  const events = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OpencodeEvent);

  const sessionId =
    [...events]
      .reverse()
      .find((event) => typeof event.sessionID === "string")?.sessionID ??
    undefined;
  const content = events
    .filter(
      (event): event is Extract<OpencodeEvent, { type: "text" }> =>
        event.type === "text",
    )
    .map((event) => event.part?.text ?? "")
    .join("");
  const lastStepFinish = [...events]
    .reverse()
    .find(
      (event): event is Extract<OpencodeEvent, { type: "step_finish" }> =>
        event.type === "step_finish",
    );

  return {
    sessionId,
    content,
    raw: events,
    usage: lastStepFinish?.part?.tokens
      ? {
          inputTokens: lastStepFinish.part.tokens.input,
          outputTokens: lastStepFinish.part.tokens.output,
          cachedInputTokens:
            (lastStepFinish.part.tokens.cache?.read ?? 0) +
            (lastStepFinish.part.tokens.cache?.write ?? 0),
          raw: lastStepFinish.part.tokens,
        }
      : undefined,
  };
}

function parseOpencodeError(stdout: string, fallback: string): MultiagentError | null {
  try {
    const lastEvent = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OpencodeEvent)
      .at(-1);

    if (lastEvent?.type === "error") {
      return new MultiagentError(
        lastEvent.error?.data?.message ??
          lastEvent.error?.message ??
          fallback,
      );
    }
  } catch {
    // ignore JSON parsing fallback errors
  }

  return null;
}

export class OpencodeHarness extends BaseHarness {
  readonly name = "opencode" as const;

  constructor(options: AgentHarnessOptions) {
    super(options);
  }

  async runTurn(input: AgentRunInput): Promise<AgentHarnessRunResult> {
    const binaryPath = resolveOpencodeBinaryPath();
    const normalizedServers = this.normalizeMcpServers(input.mcpServers);
    const args = ["run", "--format", "json"];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    if (this.sessionId) {
      args.push("--session", this.sessionId);
    }

    if (this.options.args?.length) {
      args.push(...this.options.args);
    }

    args.push(input.prompt);

    try {
      const { stdout } = await runCommand({
        command: binaryPath,
        args,
        cwd: this.options.cwd ?? input.cwd,
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify(
            buildOpencodeConfig(normalizedServers),
          ),
          ...(this.options.env ?? {}),
        },
      });

      const result = parseOpencodeJsonl(stdout);
      this.sessionId = result.sessionId ?? this.sessionId;
      return {
        ...result,
        sessionId: this.sessionId,
      };
    } catch (error) {
      if (error instanceof CommandExecutionError) {
        const parsedError = parseOpencodeError(
          error.details.stdout,
          `OpenCode exited with code ${error.details.exitCode ?? "unknown"}.`,
        );
        if (parsedError) {
          throw parsedError;
        }
      }

      throw error;
    }
  }
}
