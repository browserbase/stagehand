import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as http from "http";
import { resolveWsTarget } from "../src/resolve-ws";

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/json/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/abc123`,
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("resolveWsTarget", () => {
  it("resolves a bare port via /json/version", async () => {
    const result = await resolveWsTarget(String(port));
    expect(result).toBe(`ws://127.0.0.1:${port}/devtools/browser/abc123`);
  });

  it("falls back to ws://127.0.0.1:{port}/devtools/browser when /json/version is unavailable", async () => {
    const result = await resolveWsTarget("19999");
    expect(result).toBe("ws://127.0.0.1:19999/devtools/browser");
  });

  it("passes through ws:// URLs as-is", async () => {
    const url = "ws://localhost:9222/devtools/browser/xyz";
    expect(await resolveWsTarget(url)).toBe(url);
  });

  it("passes through wss:// URLs as-is", async () => {
    const url = "wss://remote.host/devtools/browser/xyz";
    expect(await resolveWsTarget(url)).toBe(url);
  });

  it("passes through http:// URLs as-is", async () => {
    const url = "http://localhost:9222/json/version";
    expect(await resolveWsTarget(url)).toBe(url);
  });
});
