import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v4";
import { CodeSessionManager, codeExecuteResultText } from "./session-manager.js";
import { CODE_EXECUTE_ACTIONS, type CodeExecuteInput } from "./types.js";

const DEFAULT_PORT = 8932;
const DEFAULT_HOST = "127.0.0.1";

export type CodeModeHttpServerOptions = {
  manager: CodeSessionManager;
  port?: number;
  host?: string;
  bearerToken?: string;
};

export type RunningCodeModeHttpServer = {
  url: string;
  close(): Promise<void>;
};

export function createCodeModeMcpServer(manager: CodeSessionManager): McpServer {
  const server = new McpServer({
    name: "stagehand-v4-codemode",
    version: "0.1.0",
  });

  server.registerTool(
    "code_execute",
    {
      title: "Execute Stagehand V4 code",
      description: [
        "Execute JavaScript against a long-lived Stagehand V4 browser running exclusively on Browserbase.",
        "The first action=run lazily creates the remote browser. Later calls reuse it by passing the returned opaque code_session_id.",
        "page, context, stagehand, z, and console are already in scope. Use await directly and return JSON-serializable values.",
        "Do not call stagehand.close(); use action=close when the task is finished.",
      ].join(" "),
      inputSchema: {
        action: z.enum(CODE_EXECUTE_ACTIONS).default("run"),
        code_session_id: z
          .string()
          .optional()
          .describe("Opaque code session ID returned by an earlier run."),
        code: z
          .string()
          .optional()
          .describe("Async JavaScript function body. Required for action=run."),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .max(300_000)
          .optional()
          .describe("Execution timeout in milliseconds."),
      },
      outputSchema: z
        .object({
          ok: z.boolean(),
          action: z.enum(CODE_EXECUTE_ACTIONS),
        })
        .loose(),
    },
    async (arguments_, extra) => {
      const result = await manager.execute(arguments_ as CodeExecuteInput, extra.signal);
      return {
        content: [{ type: "text" as const, text: codeExecuteResultText(result) }],
        structuredContent: result,
        isError: !result.ok,
      };
    },
  );

  return server;
}

export async function connectCodeModeStdio(manager: CodeSessionManager): Promise<McpServer> {
  const server = createCodeModeMcpServer(manager);
  await server.connect(new StdioServerTransport());
  return server;
}

export async function startCodeModeHttpServer(
  options: CodeModeHttpServerOptions,
): Promise<RunningCodeModeHttpServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  if (!options.bearerToken && !isLoopbackHost(host)) {
    throw new Error(
      "CODEMODE_MCP_BEARER_TOKEN is required when the HTTP server binds to a non-loopback host.",
    );
  }
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer }
  >();
  let closing = false;

  const httpServer = http.createServer(async (request, response) => {
    try {
      if (closing) {
        response.writeHead(503).end("Server is shutting down");
        return;
      }
      if (!options.bearerToken && !isSafeLoopbackRequest(request)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (!authorized(request, options.bearerToken)) {
        response.writeHead(401, { "www-authenticate": "Bearer" }).end("Unauthorized");
        return;
      }
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (url.pathname === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: true,
            browserProvisioning: "lazy",
            activeCodeSessions: options.manager.activeSessionCount,
          }),
        );
        return;
      }
      if (url.pathname !== "/mcp") {
        response.writeHead(404).end("Not found");
        return;
      }

      const mcpSessionId = request.headers["mcp-session-id"];
      if (typeof mcpSessionId === "string") {
        const active = sessions.get(mcpSessionId);
        if (!active) {
          response.writeHead(404).end("MCP session not found");
          return;
        }
        await active.transport.handleRequest(request, response);
        return;
      }

      if (request.method !== "POST") {
        response.writeHead(400).end("MCP initialization requires POST");
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, { transport, server });
        },
      });
      const server = createCodeModeMcpServer(options.manager);
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
      }
      if (!response.writableEnded) response.end(JSON.stringify({ error: message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind a port.");
  const resolvedHost =
    address.address === "0.0.0.0" || address.address === "::"
      ? "127.0.0.1"
      : address.family === "IPv6"
        ? `[${address.address}]`
        : address.address;
  const serverUrl = `http://${resolvedHost}:${address.port}/mcp`;
  let closePromise: Promise<void> | undefined;

  return {
    url: serverUrl,
    close() {
      closePromise ??= (async () => {
        closing = true;
        const stopped = new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
        httpServer.closeAllConnections();
        for (const { transport, server } of sessions.values()) {
          await transport.close().catch(() => undefined);
          await server.close().catch(() => undefined);
        }
        sessions.clear();
        await options.manager.closeAll();
        await stopped;
      })();
      return closePromise;
    },
  };
}

function authorized(request: http.IncomingMessage, expected?: string): boolean {
  if (!expected) return true;
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isSafeLoopbackRequest(request: http.IncomingMessage): boolean {
  if (!isLoopbackAuthority(request.headers.host)) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      isLoopbackHost(normalizeHostname(parsed.hostname))
    );
  } catch {
    return false;
  }
}

function isLoopbackAuthority(authority: string | undefined): boolean {
  if (!authority) return false;
  try {
    const parsed = new URL(`http://${authority}`);
    return isLoopbackHost(normalizeHostname(parsed.hostname));
  } catch {
    return false;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname.toLowerCase();
}
