import type {
  AgentHarnessRunResult,
  AgentHarnessOptions,
  AgentRunInput,
  NamedStdioLaunchConfig,
} from "../../types.js";
import { runCommand } from "../../utils/process.js";
import { BaseHarness } from "./base.js";

type ClaudeJsonResult = {
  result?: string;
  session_id?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

function buildClaudeMcpConfig(mcpServers: NamedStdioLaunchConfig[]): string {
  const mcpServersRecord = Object.fromEntries(
    mcpServers.map((server) => [
      server.name,
      {
        command: server.config.command,
        args: server.config.args ?? [],
        env: server.config.env ?? {},
      },
    ]),
  );

  return JSON.stringify({ mcpServers: mcpServersRecord }, null, 2);
}

export class ClaudeCodeHarness extends BaseHarness {
  readonly name = "claude-code" as const;

  constructor(options: AgentHarnessOptions) {
    super(options);
  }

  async runTurn(input: AgentRunInput): Promise<AgentHarnessRunResult> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      this.options.permissionMode ?? "bypassPermissions",
    ];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    const normalizedServers = this.normalizeMcpServers(input.mcpServers);
    if (normalizedServers.length > 0) {
      const configPath = await this.writeTempFile(
        "claude-mcp.json",
        buildClaudeMcpConfig(normalizedServers),
      );
      args.push("--mcp-config", configPath, "--strict-mcp-config");
    }

    if (this.sessionId) {
      args.push("--resume", this.sessionId);
    }

    if (this.options.args?.length) {
      args.push(...this.options.args);
    }

    args.push(input.prompt);

    const { stdout } = await runCommand({
      command: "claude",
      args,
      cwd: this.options.cwd ?? input.cwd,
      env: this.options.env,
    });

    const parsed = JSON.parse(stdout.trim()) as ClaudeJsonResult;
    this.sessionId = parsed.session_id ?? this.sessionId;

    return {
      sessionId: this.sessionId,
      content: String(parsed.result ?? ""),
      raw: parsed,
      usage: parsed.usage
        ? {
            inputTokens: parsed.usage.input_tokens,
            outputTokens: parsed.usage.output_tokens,
            cachedInputTokens:
              (parsed.usage.cache_creation_input_tokens ?? 0) +
              (parsed.usage.cache_read_input_tokens ?? 0),
            raw: parsed.usage,
          }
        : undefined,
    };
  }
}
