/**
 * browse_cli as an MCP mount.
 *
 * Harnesses that drive a shell (claude_code, codex) expose browse_cli by
 * putting a pinned `browse` wrapper on PATH and letting the agent call it from
 * Bash. Harnesses whose agent process is not a shell host — Deep Agents runs as
 * a separate Python process whose only tool channel is stdio MCP — cannot use
 * that path at all, which is why browse_cli was unavailable to them.
 *
 * This bridge closes that gap without changing the surface the model sees: a
 * single `browse` tool whose one argument is the exact command line the browse
 * skill documents. The command allowlist is the same one the Claude Code
 * adapter enforces in `canUseTool`, so neither harness can run anything but
 * `browse`, and one tool call still maps to one browse command.
 *
 * The transport mirrors the Stagehand facade bridge: the MCP server itself runs
 * in the harness process (so it can log through `EvalLogger` and share the
 * adapter's wrapper/env), and the agent is handed a dependency-free `node -e`
 * relay that pipes its stdio to the bridge's loopback port.
 */
import { execFile } from "node:child_process";
import net from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { isAllowedBrowseCommand } from "./claudeCodeToolAdapter.js";

/** Port of the loopback MCP bridge, read by the relay the agent spawns. */
export const BROWSE_CLI_MCP_BRIDGE_PORT_ENV = "EVAL_BROWSE_CLI_MCP_BRIDGE_PORT";

/** MCP server name; tool names are reported as `${server}.${tool}`. */
export const BROWSE_CLI_MCP_SERVER_NAME = "browse";

/** The single tool the bridge exposes. */
export const BROWSE_CLI_MCP_TOOL_NAME = "browse";

const BROWSE_CLI_MCP_TOOL_DESCRIPTION =
  "Run one browse CLI command against the browser session pinned to this eval. " +
  "Pass the full command line, including the leading `browse` (for example " +
  "`browse open https://example.com`). There is no shell: exactly one command " +
  "per call, no pipes, redirection, or chaining. Environment and session flags " +
  "are appended by the harness — never pass --local, --remote, or --session.";

const BROWSE_CLI_MCP_COMMAND_DESCRIPTION =
  "A single browse command line, e.g. `browse snapshot` or `browse click @e12`.";

/**
 * Same shape as the facade relay: pipe stdio to the bridge port and exit when
 * either side closes. Kept dependency-free so it runs under bare `node -e`.
 */
export const BROWSE_CLI_MCP_RELAY_SCRIPT = `const net=require("node:net");const port=Number(process.env.${BROWSE_CLI_MCP_BRIDGE_PORT_ENV});const socket=net.createConnection({host:"127.0.0.1",port});let connected=false;socket.once("connect",()=>{connected=true;process.stdin.pipe(socket);socket.pipe(process.stdout);});socket.once("error",(error)=>{process.stderr.write("browse_cli mcp relay: "+error.message+"\\n");if(!connected)process.exit(1);});socket.once("close",()=>process.exit(0));process.stdin.once("end",()=>socket.end());`;

export interface BrowseCliMcpBridgeInput {
  /** Pinned `browse` wrapper created by `prepareBrowseCliHarnessAdapter`. */
  wrapperPath: string;
  cwd: string;
  env: Record<string, string>;
  logger: EvalLogger;
  logCategory: string;
}

export interface BrowseCliMcpBridge {
  port: number;
  /** stdio server spec the agent spawns; `env` carries only the bridge port. */
  mcpServerSpec: { command: string; args: string[]; env: Record<string, string> };
  close: () => Promise<void>;
}

/**
 * Splits a validated browse command line into argv.
 *
 * `isAllowedBrowseCommand` has already rejected shell metacharacters, so the
 * only shell syntax left to honor is quoting: anything else would silently
 * change the argument the model meant to pass.
 */
export function tokenizeBrowseCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === "\\" && quote !== "'" && index + 1 < command.length) {
      current += command[index + 1];
      started = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (quote) throw new EvalsError(`Unterminated ${quote} quote in browse command.`);
  if (started) tokens.push(current);

  if (tokens[0] !== "browse") {
    throw new EvalsError("Only browse commands are allowed for this eval harness.");
  }
  return tokens.slice(1);
}

export async function startBrowseCliMcpBridge(
  input: BrowseCliMcpBridgeInput,
): Promise<BrowseCliMcpBridge> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    void connectMcpServer(socket, input);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new EvalsError("browse_cli MCP bridge did not bind a loopback port."));
        return;
      }
      resolve(address.port);
    });
  });

  let closePromise: Promise<void> | undefined;
  return {
    port,
    mcpServerSpec: {
      command: process.execPath,
      args: ["-e", BROWSE_CLI_MCP_RELAY_SCRIPT],
      env: { [BROWSE_CLI_MCP_BRIDGE_PORT_ENV]: String(port) },
    },
    close: async () => {
      closePromise ??= new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        sockets.clear();
        server.close(() => resolve());
      });
      await closePromise;
    },
  };
}

async function connectMcpServer(socket: net.Socket, input: BrowseCliMcpBridgeInput): Promise<void> {
  // One MCP server per connection: a server owns its transport, and the Deep
  // Agents runner opens a fresh stdio client per session.
  const mcp = new McpServer({ name: "stagehand-evals-browse-cli", version: "1.0.0" });
  mcp.registerTool(
    BROWSE_CLI_MCP_TOOL_NAME,
    {
      description: BROWSE_CLI_MCP_TOOL_DESCRIPTION,
      inputSchema: { command: z.string().describe(BROWSE_CLI_MCP_COMMAND_DESCRIPTION) },
    },
    ({ command }) => runBrowseCommand(command, input),
  );

  try {
    await mcp.connect(new StdioServerTransport(socket, socket));
  } catch (error) {
    input.logger.warn({
      category: input.logCategory,
      message: `browse_cli MCP bridge connection failed: ${describeError(error)}`,
      level: 1,
    });
    socket.destroy();
  }
}

async function runBrowseCommand(
  command: string,
  input: BrowseCliMcpBridgeInput,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  if (!isAllowedBrowseCommand(command)) {
    return toolError("Only browse commands are allowed for this eval harness.");
  }

  let args: string[];
  try {
    args = tokenizeBrowseCommand(command.trim());
  } catch (error) {
    return toolError(describeError(error));
  }

  input.logger.log({
    category: input.logCategory,
    message: `browse tool: ${command.trim()}`,
    level: 2,
  });

  try {
    const { stdout, stderr } = await execFileAsync(input.wrapperPath, args, {
      cwd: input.cwd,
      env: input.env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: readPositiveIntEnv("EVAL_BROWSE_CLI_TOOL_TIMEOUT_MS", 120_000),
    });
    const text = stdout.trim() || stderr.trim() || "(no output)";
    return { content: [{ type: "text", text }] };
  } catch (error) {
    const detail = execFailureDetail(error) || describeError(error);
    input.logger.warn({
      category: input.logCategory,
      message: `browse tool failed (${command.trim()}): ${detail}`,
      level: 1,
    });
    return toolError(detail);
  }
}

const execFileAsync = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; maxBuffer: number; timeout: number },
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

function execFailureDetail(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown };
  const detail = [stderr, stdout]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return detail ?? "";
}

function toolError(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
