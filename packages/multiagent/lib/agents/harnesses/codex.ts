import type {
  AgentHarnessOptions,
  AgentHarnessRunResult,
  AgentRunInput,
  NamedStdioLaunchConfig,
} from "../../types.js";
import { runCommand } from "../../utils/process.js";
import { BaseHarness } from "./base.js";

type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "item.completed"; item: { type: string; text?: string } }
  | {
      type: "turn.completed";
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cached_input_tokens?: number;
      };
    };

function sanitizeServerName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  const entries = Object.entries(values).map(
    ([key, value]) => `${key}=${tomlString(value)}`,
  );
  return `{${entries.join(", ")}}`;
}

function buildCodexMcpArgs(mcpServers: NamedStdioLaunchConfig[]): string[] {
  const args: string[] = [];

  for (const server of mcpServers) {
    const name = sanitizeServerName(server.name);
    args.push("-c", `mcp_servers.${name}.command=${tomlString(server.config.command)}`);
    args.push(
      "-c",
      `mcp_servers.${name}.args=${tomlArray(server.config.args ?? [])}`,
    );
    if (server.config.env && Object.keys(server.config.env).length > 0) {
      args.push(
        "-c",
        `mcp_servers.${name}.env=${tomlInlineTable(server.config.env)}`,
      );
    }
  }

  return args;
}

function parseCodexJsonl(stdout: string): AgentHarnessRunResult {
  const events = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CodexEvent);

  const threadStarted = events.find(
    (event): event is Extract<CodexEvent, { type: "thread.started" }> =>
      event.type === "thread.started",
  );
  const agentMessages = events.filter(
    (event): event is Extract<CodexEvent, { type: "item.completed" }> =>
      event.type === "item.completed" && event.item.type === "agent_message",
  );
  const turnCompleted = events.find(
    (event): event is Extract<CodexEvent, { type: "turn.completed" }> =>
      event.type === "turn.completed",
  );

  return {
    sessionId: threadStarted?.thread_id,
    content: agentMessages.at(-1)?.item.text ?? "",
    raw: events,
    usage: turnCompleted?.usage
      ? {
          inputTokens: turnCompleted.usage.input_tokens,
          outputTokens: turnCompleted.usage.output_tokens,
          cachedInputTokens: turnCompleted.usage.cached_input_tokens,
          raw: turnCompleted.usage,
        }
      : undefined,
  };
}

export class CodexHarness extends BaseHarness {
  readonly name = "codex" as const;

  constructor(options: AgentHarnessOptions) {
    super(options);
  }

  async runTurn(input: AgentRunInput): Promise<AgentHarnessRunResult> {
    const baseArgs = this.sessionId
      ? ["exec", "resume", "--json", this.sessionId]
      : ["exec", "--json"];

    const args = [...baseArgs];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    args.push(
      "-c",
      `approval_policy=${tomlString(this.options.permissionMode ?? "never")}`,
      "-c",
      `sandbox_mode=${tomlString("workspace-write")}`,
      "-c",
      "sandbox_workspace_write.network_access=true",
    );

    args.push(...buildCodexMcpArgs(this.normalizeMcpServers(input.mcpServers)));

    if (this.options.args?.length) {
      args.push(...this.options.args);
    }

    args.push(input.prompt);

    const { stdout } = await runCommand({
      command: "codex",
      args,
      cwd: this.options.cwd ?? input.cwd,
      env: this.options.env,
    });

    const result = parseCodexJsonl(stdout);
    this.sessionId = result.sessionId ?? this.sessionId;
    return {
      ...result,
      sessionId: this.sessionId,
    };
  }
}
