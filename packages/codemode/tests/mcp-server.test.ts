import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { startCodeModeHttpServer } from "../src/mcp-server.js";
import { CodeSessionManager } from "../src/session-manager.js";
import type { CodeRuntime } from "../src/types.js";

function managerThatMustStayIdle(): CodeSessionManager {
  return new CodeSessionManager({
    runtimeFactory: () => {
      throw new Error("The HTTP safety test must not create a browser runtime.");
    },
  });
}

describe("code-mode HTTP server", () => {
  it("refuses an unauthenticated non-loopback bind", async () => {
    await expect(
      startCodeModeHttpServer({
        manager: managerThatMustStayIdle(),
        host: "0.0.0.0",
        port: 0,
      }),
    ).rejects.toThrow(/bearer_token is required/i);
  });

  it("allows an unauthenticated loopback server for local development", async () => {
    const server = await startCodeModeHttpServer({
      manager: managerThatMustStayIdle(),
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const health = await fetch(new URL("/health", server.url)).then((response) =>
        response.json(),
      );
      expect(health).toMatchObject({
        ok: true,
        browserProvisioning: "lazy",
        activeCodeSessions: 0,
      });
    } finally {
      await server.close();
    }
  });

  it("rejects hostile Host and Origin headers on unauthenticated loopback", async () => {
    const server = await startCodeModeHttpServer({
      manager: managerThatMustStayIdle(),
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const hostileHost = await request(server.url, { host: "attacker.example" });
      expect(hostileHost.status).toBe(403);

      const hostileOrigin = await request(server.url, {
        origin: "https://attacker.example",
      });
      expect(hostileOrigin.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("protects health metadata when bearer authentication is configured", async () => {
    const server = await startCodeModeHttpServer({
      manager: managerThatMustStayIdle(),
      host: "127.0.0.1",
      port: 0,
      bearerToken: "test-token",
    });
    try {
      const healthUrl = new URL("/health", server.url);
      expect((await request(healthUrl)).status).toBe(401);
      const authorized = await request(healthUrl, {
        authorization: "Bearer test-token",
      });
      expect(authorized.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("closes every code session when the HTTP server stops", async () => {
    const runtime = fakeRuntime();
    const close = vi.spyOn(runtime, "close");
    const manager = new CodeSessionManager({
      runtimeFactory: () => runtime,
      sessionIdFactory: () => "code_server_shutdown",
    });
    await manager.execute({ action: "run", code: "return true" });
    const server = await startCodeModeHttpServer({
      manager,
      host: "127.0.0.1",
      port: 0,
    });

    await server.close();

    expect(close).toHaveBeenCalledOnce();
    expect(manager.activeSessionCount).toBe(0);
  });
});

function fakeRuntime(): CodeRuntime {
  return {
    async run() {
      return {
        value: true,
        logs: [],
        page: { url: "about:blank", title: "" },
      };
    },
    async status() {
      return { state: "ready" };
    },
    async reset() {},
    async close() {},
  };
}

function request(
  target: string | URL,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(target, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}
