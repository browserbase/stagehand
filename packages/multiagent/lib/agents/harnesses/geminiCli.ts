import fs from "node:fs/promises";
import path from "node:path";
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

export interface GeminiJsonResult {
  session_id?: string;
  response?: string;
  stats?: Record<string, unknown>;
  error?: {
    type?: string;
    message?: string;
    code?: number | string;
  };
}

function normalizeApprovalMode(permissionMode?: string): string {
  if (
    permissionMode === "default" ||
    permissionMode === "auto_edit" ||
    permissionMode === "yolo" ||
    permissionMode === "plan"
  ) {
    return permissionMode;
  }

  if (
    permissionMode === "bypassPermissions" ||
    permissionMode === "never"
  ) {
    return "yolo";
  }

  return "yolo";
}

export function buildGeminiSettings(
  mcpServers: NamedStdioLaunchConfig[],
): Record<string, unknown> {
  const settings: Record<string, unknown> = {};

  if (mcpServers.length > 0) {
    settings.mcpServers = Object.fromEntries(
      mcpServers.map((server) => [
        server.name,
        {
          type: "stdio",
          command: server.config.command,
          args: server.config.args ?? [],
          env: server.config.env ?? {},
          cwd: server.config.cwd,
        },
      ]),
    );
    settings.mcp = {
      allowed: mcpServers.map((server) => server.name),
    };
  }

  return settings;
}

export function parseGeminiJsonResult(stdout: string): GeminiJsonResult {
  const trimmed = stdout.trim();
  const jsonStart = trimmed.indexOf("{");

  if (jsonStart === -1) {
    throw new Error("Gemini CLI did not emit JSON output.");
  }

  return JSON.parse(trimmed.slice(jsonStart)) as GeminiJsonResult;
}

function buildGeminiError(
  parsed: GeminiJsonResult,
  fallback: string,
): MultiagentError {
  return new MultiagentError(parsed.error?.message ?? fallback);
}

export class GeminiCliHarness extends BaseHarness {
  readonly name = "gemini-cli" as const;

  constructor(options: AgentHarnessOptions) {
    super(options);
  }

  async runTurn(input: AgentRunInput): Promise<AgentHarnessRunResult> {
    const tempHome = await this.createTempDir("multiagent-gemini");
    const geminiDir = path.join(tempHome, ".gemini");
    await fs.mkdir(geminiDir, { recursive: true });

    const normalizedServers = this.normalizeMcpServers(input.mcpServers);
    const settingsPath = path.join(geminiDir, "settings.json");
    await fs.writeFile(
      settingsPath,
      JSON.stringify(buildGeminiSettings(normalizedServers), null, 2),
      "utf8",
    );

    const args = [
      "--prompt",
      input.prompt,
      "--output-format",
      "json",
      "--approval-mode",
      normalizeApprovalMode(this.options.permissionMode),
    ];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    if (normalizedServers.length > 0) {
      args.push(
        "--allowed-mcp-server-names",
        ...normalizedServers.map((server) => server.name),
      );
    }

    if (this.options.args?.length) {
      args.push(...this.options.args);
    }

    try {
      const { stdout } = await runCommand({
        command: "gemini",
        args,
        cwd: this.options.cwd ?? input.cwd,
        env: {
          GEMINI_CLI_HOME: tempHome,
          ...(this.options.env ?? {}),
        },
      });

      const parsed = parseGeminiJsonResult(stdout);
      if (parsed.error) {
        throw buildGeminiError(parsed, "Gemini CLI returned an error.");
      }

      this.sessionId = parsed.session_id ?? this.sessionId;
      return {
        sessionId: this.sessionId,
        content: parsed.response ?? "",
        raw: parsed,
        usage: parsed.stats
          ? {
              raw: parsed.stats,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof CommandExecutionError) {
        for (const candidate of [error.details.stdout, error.details.stderr]) {
          if (!candidate.trim()) {
            continue;
          }

          try {
            const parsed = parseGeminiJsonResult(candidate);
            if (parsed.error) {
              throw buildGeminiError(
                parsed,
                `Gemini CLI exited with code ${error.details.exitCode ?? "unknown"}.`,
              );
            }
          } catch (parseError) {
            if (parseError instanceof MultiagentError) {
              throw parseError;
            }
          }
        }
      }

      throw error;
    }
  }
}
