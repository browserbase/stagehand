/**
 * A harness-hosted MCP server reachable over stdio.
 *
 * Harnesses whose agent runs out of process and whose only tool channel is a
 * stdio MCP server (Deep Agents' Python runner) cannot be handed an in-process
 * SDK server the way claude-agent-sdk allows, and an independently spawned MCP
 * process could not see this process's live surface handles or the eval's
 * pinned CLI session. So the server stays here and the agent is handed a
 * dependency-free `node -e` relay that pipes its stdio to a loopback port —
 * the same shape `stagehandFacadeBridge` already uses for its agent relay.
 *
 * This module owns only the transport. What the server exposes comes from the
 * caller's `register` callback.
 */
import net from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";

/** Port of the loopback bridge, read by the relay the agent spawns. */
export const MCP_LOOPBACK_BRIDGE_PORT_ENV = "EVAL_MCP_LOOPBACK_BRIDGE_PORT";

/**
 * Pipe stdio to the bridge port and exit when either side closes. Kept
 * dependency-free so it runs under a bare `node -e`.
 */
export const MCP_LOOPBACK_RELAY_SCRIPT = `const net=require("node:net");const port=Number(process.env.${MCP_LOOPBACK_BRIDGE_PORT_ENV});const socket=net.createConnection({host:"127.0.0.1",port});let connected=false;socket.once("connect",()=>{connected=true;process.stdin.pipe(socket);socket.pipe(process.stdout);});socket.once("error",(error)=>{process.stderr.write("stagehand evals mcp relay: "+error.message+"\\n");if(!connected)process.exit(1);});socket.once("close",()=>process.exit(0));process.stdin.once("end",()=>socket.end());`;

export interface McpLoopbackBridgeInput {
  /** MCP `serverInfo.name`; reported to the client, not the tool prefix. */
  serverName: string;
  /** Registers the tools this bridge exposes, once per client connection. */
  register: (server: McpServer) => void;
  logger: EvalLogger;
  logCategory: string;
}

export interface McpLoopbackBridge {
  port: number;
  /** stdio server spec the agent spawns; `env` carries only the bridge port. */
  mcpServerSpec: { command: string; args: string[]; env: Record<string, string> };
  close: () => Promise<void>;
}

export async function startMcpLoopbackBridge(
  input: McpLoopbackBridgeInput,
): Promise<McpLoopbackBridge> {
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
        reject(new EvalsError(`${input.serverName} bridge did not bind a loopback port.`));
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
      args: ["-e", MCP_LOOPBACK_RELAY_SCRIPT],
      env: { [MCP_LOOPBACK_BRIDGE_PORT_ENV]: String(port) },
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

async function connectMcpServer(socket: net.Socket, input: McpLoopbackBridgeInput): Promise<void> {
  // One MCP server per connection: a server owns its transport, and the agent
  // runner opens a fresh stdio client per session.
  const mcp = new McpServer({ name: input.serverName, version: "1.0.0" });
  input.register(mcp);
  try {
    await mcp.connect(new StdioServerTransport(socket, socket));
  } catch (error) {
    input.logger.warn({
      category: input.logCategory,
      message: `${input.serverName} bridge connection failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      level: 1,
    });
    socket.destroy();
  }
}
