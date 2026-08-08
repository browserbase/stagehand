import assert from "node:assert/strict";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export type EveContractServer = {
  url: string;
  token: string;
  codeExecuteCalls: () => number;
  close: () => Promise<void>;
};

export async function startEveContractServer(): Promise<EveContractServer> {
  const token = randomBytes(32).toString("hex");
  const expectedAuthorization = Buffer.from(`Bearer ${token}`);
  let codeExecuteCalls = 0;
  const app = createMcpExpressApp();

  app.use("/mcp", (request, response, next) => {
    const authorization = request.headers.authorization;
    const provided = authorization === undefined ? undefined : Buffer.from(authorization);
    if (
      provided === undefined ||
      provided.length !== expectedAuthorization.length ||
      !timingSafeEqual(provided, expectedAuthorization)
    ) {
      response.status(401).type("text/plain").send("Unauthorized\n");
      return;
    }
    next();
  });

  app.post("/mcp", async (request, response) => {
    const server = new McpServer({ name: "eve-stagehand-contract", version: "1.0.0" });
    server.registerTool(
      "code_execute",
      {
        description:
          "# Stagehand V4 code-mode syntax\nContract-only Stagehand browser execution tool.",
        inputSchema: { code: z.string() },
      },
      async () => {
        codeExecuteCalls += 1;
        const value = {
          pageId: "contract-page",
          title: "Example Domain",
          directMarker: "eve-direct-persistent",
          ...(codeExecuteCalls > 1 ? { modelMarker: "eve-model-persistent" } : {}),
          modelKeyVisible: null,
          hostMarkerVisible: null,
        };
        const result = { ok: true, value };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    );

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch {
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Contract MCP request failed" },
          id: null,
        });
      }
    }
  });
  app.get("/mcp", (_request, response) => {
    response.status(405).set("Allow", "POST").send("Method Not Allowed");
  });
  app.delete("/mcp", (_request, response) => {
    response.status(405).set("Allow", "POST").send("Method Not Allowed");
  });

  const httpServer = app.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    codeExecuteCalls: () => codeExecuteCalls,
    close: () => closeServer(httpServer),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
