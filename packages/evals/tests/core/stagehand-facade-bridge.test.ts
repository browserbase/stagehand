import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  FACADE_RELAY_SCRIPT,
  StagehandFacadeBridgeError,
  STAGEHAND_FACADE_BRIDGE_PORT_ENV,
  startStagehandFacadeBridge,
  type StagehandFacadeBridge,
} from "../../core/tools/stagehandFacadeBridge.js";

const FAKE_FACADE_SOURCE = String.raw`
let carry = "";
let initializeCount = 0;
let toolCalls = 0;
function reply(message) { process.stdout.write(JSON.stringify(message) + "\n"); }
function result(id, value) { reply({ jsonrpc: "2.0", id, result: value }); }
function text(value) { return { content: [{ type: "text", text: value }] }; }
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  carry += chunk;
  const lines = carry.split("\n");
  carry = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      initializeCount += 1;
      result(request.id, {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fake-facade" },
      });
    } else if (request.method === "tools/list") {
      result(request.id, { tools: ["run", "snapshot", "screenshot"].map((name) => ({ name })) });
    } else if (request.method === "tools/call") {
      toolCalls += 1;
      const name = request.params.name;
      if (name === "__exit") {
        process.exit(5);
      } else if (name === "__stats") {
        result(request.id, text(JSON.stringify({ initializeCount, toolCalls, lastRequestIdType: typeof request.id })));
      } else if (name === "screenshot") {
        result(request.id, {
          content: [
            { type: "text", text: "Screenshot captured." },
            { type: "image", data: Buffer.from("png-bytes").toString("base64"), mimeType: "image/png" },
          ],
        });
      } else if (name === "run") {
        result(request.id, text(request.params.arguments.code === "return page.url();" ? "https://example.com/final" : "ok"));
      } else if (name === "snapshot") {
        result(request.id, text("[1-1] RootWebArea: Example"));
      } else {
        reply({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown tool: " + name } });
      }
    } else if (request.id !== undefined) {
      reply({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown method: " + request.method } });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

let tempDir: string;
let scriptPath: string;
const bridges = new Set<StagehandFacadeBridge>();

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "stagehand-facade-bridge-"));
  scriptPath = path.join(tempDir, "fake-facade.cjs");
  await writeFile(scriptPath, FAKE_FACADE_SOURCE);
});

afterEach(async () => {
  await Promise.all([...bridges].map((bridge) => bridge.close()));
  bridges.clear();
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function startBridge(): Promise<StagehandFacadeBridge> {
  const bridge = await startStagehandFacadeBridge({
    server: { command: process.execPath, args: [scriptPath], env: {} },
  });
  bridges.add(bridge);
  return bridge;
}

function startRelay(bridge: StagehandFacadeBridge): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["-e", FACADE_RELAY_SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { [STAGEHAND_FACADE_BRIDGE_PORT_ENV]: String(bridge.port) },
  });
}

function collectResponses(child: ChildProcessWithoutNullStreams): {
  response(id: string | number): Promise<Record<string, unknown>>;
} {
  const responses = new Map<string, Record<string, unknown>>();
  const waiters = new Map<
    string,
    {
      resolve: (message: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  let carry = "";
  let endedError: Error | undefined;
  const onData = (chunk: Buffer | string) => {
    carry += chunk.toString();
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      const key = `${typeof message.id}:${String(message.id)}`;
      const waiter = waiters.get(key);
      if (waiter) {
        waiters.delete(key);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        responses.set(key, message);
      }
    }
  };
  const onEnd = () => {
    if (endedError) return;
    endedError = new Error("Relay stdout ended before the expected response");
    child.stdout.off("data", onData);
    for (const waiter of waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(endedError);
    }
    waiters.clear();
  };
  child.stdout.on("data", onData);
  child.stdout.once("end", onEnd);
  child.stdout.once("close", onEnd);
  return {
    response: (id) => {
      const key = `${typeof id}:${String(id)}`;
      const existing = responses.get(key);
      if (existing) {
        responses.delete(key);
        return Promise.resolve(existing);
      }
      if (endedError) return Promise.reject(endedError);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(key);
          reject(new Error(`Timed out waiting for relay response ${String(id)}`));
        }, 2_000);
        waiters.set(key, { resolve, reject, timer });
      });
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for bridge state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for relay exit")), 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("stagehand facade bridge", () => {
  it("initializes the facade without launching evidence tools", async () => {
    const bridge = await startBridge();

    const listed = (await bridge.call("tools/list")) as { tools: unknown[] };
    expect(listed.tools).toHaveLength(3);
    expect(bridge.sawAgentToolCall()).toBe(false);
    await expect(bridge.captureEvidence()).resolves.toEqual({});
    expect(bridge.agentConnections()).toBe(0);
  });

  it("relays agent MCP traffic and captures step then terminal evidence", async () => {
    const bridge = await startBridge();
    const relay = startRelay(bridge);
    const secondRelay = startRelay(bridge);
    const output = collectResponses(relay);
    const secondOutput = collectResponses(secondRelay);
    await waitFor(() => bridge.agentConnections() === 2);

    relay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent", version: "1" } } })}\n`,
    );
    relay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "screenshot", arguments: {} } })}\n`,
    );
    secondRelay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: "second-init", method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "second-agent", version: "1" } } })}\n`,
    );
    relay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    secondRelay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );

    await expect(output.response(1)).resolves.toMatchObject({
      id: 1,
      result: { serverInfo: { name: "fake-facade" } },
    });
    await expect(secondOutput.response("second-init")).resolves.toMatchObject({
      id: "second-init",
      result: { serverInfo: { name: "fake-facade" } },
    });
    const screenshotResponse = await output.response(2);
    expect(screenshotResponse.id).toBe(2);
    expect(screenshotResponse).toMatchObject({
      result: { content: expect.arrayContaining([expect.objectContaining({ type: "image" })]) },
    });
    expect(bridge.sawAgentToolCall()).toBe(true);
    expect(bridge.agentConnections()).toBe(2);
    await expect(bridge.captureEvidence()).resolves.toEqual({
      screenshot: Buffer.from("png-bytes"),
      url: "https://example.com/final",
    });

    relay.stdin.end();
    secondRelay.stdin.end();
    await waitForExit(relay);
    await waitForExit(secondRelay);
    await waitFor(() => bridge.agentConnections() === 0);
    await expect(bridge.captureEvidence()).resolves.toEqual({
      screenshot: Buffer.from("png-bytes"),
      url: "https://example.com/final",
      ariaTree: "[1-1] RootWebArea: Example",
    });

    const statsResult = (await bridge.call("tools/call", {
      name: "__stats",
      arguments: {},
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(statsResult.content[0].text)).toMatchObject({
      initializeCount: 1,
      lastRequestIdType: "string",
    });
  });

  it("rejects response waiters when relay stdout closes", async () => {
    const bridge = await startBridge();
    const relay = startRelay(bridge);
    const output = collectResponses(relay);
    await waitFor(() => bridge.agentConnections() === 1);

    const response = output.response("missing");
    relay.stdin.end();

    await expect(response).rejects.toThrow(/stdout ended/iu);
    await waitForExit(relay);
  });

  it("keeps concurrent runner and agent responses on their originating clients", async () => {
    const bridge = await startBridge();
    const relay = startRelay(bridge);
    const output = collectResponses(relay);
    await waitFor(() => bridge.agentConnections() === 1);

    const runnerResponse = bridge.call("tools/call", {
      name: "run",
      arguments: { code: "x" },
    });
    relay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "screenshot", arguments: {} } })}\n`,
    );

    await expect(runnerResponse).resolves.toEqual({ content: [{ type: "text", text: "ok" }] });
    await expect(output.response(42)).resolves.toMatchObject({
      id: 42,
      result: { content: expect.arrayContaining([expect.objectContaining({ type: "image" })]) },
    });
    relay.stdin.end();
    await waitForExit(relay);
  });

  it("isolates identical request IDs from concurrent agent relays", async () => {
    const bridge = await startBridge();
    const firstRelay = startRelay(bridge);
    const secondRelay = startRelay(bridge);
    const firstOutput = collectResponses(firstRelay);
    const secondOutput = collectResponses(secondRelay);
    await waitFor(() => bridge.agentConnections() === 2);

    firstRelay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "screenshot", arguments: {} } })}\n`,
    );
    secondRelay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "run", arguments: { code: "x" } } })}\n`,
    );

    await expect(firstOutput.response(42)).resolves.toMatchObject({
      id: 42,
      result: { content: expect.arrayContaining([expect.objectContaining({ type: "image" })]) },
    });
    await expect(secondOutput.response(42)).resolves.toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { content: [{ type: "text", text: "ok" }] },
    });

    firstRelay.stdin.end();
    secondRelay.stdin.end();
    await Promise.all([waitForExit(firstRelay), waitForExit(secondRelay)]);
  });

  it("treats child stdin backpressure as a successful write", async () => {
    const bridge = await startBridge();

    await expect(
      bridge.call("tools/list", { padding: "x".repeat(2 * 1024 * 1024) }),
    ).resolves.toMatchObject({ tools: expect.any(Array) });
  });

  it("redacts remote JSON-RPC error messages", async () => {
    const bridge = await startBridge();

    const request = bridge.call("tools/call", {
      name: "https://x.test?apiKey=secret123",
      arguments: {},
    });
    await expect(request).rejects.toBeInstanceOf(StagehandFacadeBridgeError);
    await expect(request).rejects.toThrow("apiKey=[redacted]");
  });

  it("closes an agent relay when the facade has exited", async () => {
    const bridge = await startBridge();
    const relay = startRelay(bridge);
    const output = collectResponses(relay);
    await waitFor(() => bridge.agentConnections() === 1);

    relay.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "__exit", arguments: {} } })}\n`,
    );
    const firstResponse = expect(output.response(1)).rejects.toThrow(/stdout ended/iu);
    const deadline = Date.now() + 2_000;
    while (true) {
      try {
        await bridge.call("tools/list");
      } catch (error) {
        expect(error).toMatchObject({ message: expect.stringMatching(/exit code 5/iu) });
        break;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for facade exit");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await firstResponse;
    await waitForExit(relay);
    await waitFor(() => bridge.agentConnections() === 0);
  });

  it("closes the facade child and is idempotent", async () => {
    const bridge = await startBridge();

    await bridge.close();
    await bridge.close();
    await expect(bridge.call("tools/list")).rejects.toThrow(/closed/iu);
  });

  it("reports a facade that exits during initialization", async () => {
    await expect(
      startStagehandFacadeBridge({
        server: { command: process.execPath, args: ["-e", "process.exit(3)"], env: {} },
        requestTimeoutMs: 1_000,
      }),
    ).rejects.toThrow(/(?:exit )?code 3/iu);
  });

  it("redacts child stderr from exit errors", async () => {
    await expect(
      startStagehandFacadeBridge({
        server: {
          command: process.execPath,
          args: [
            "-e",
            'process.stderr.write("failed https://x.test?apiKey=secret123\\n"); process.exit(4)',
          ],
          env: {},
        },
        requestTimeoutMs: 1_000,
      }),
    ).rejects.toThrow("apiKey=[redacted]");
  });
});
