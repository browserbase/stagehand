import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CDPClient, CDPConnectionClosedError } from "../src/cdpClient.js";

class Socket extends EventTarget {
  readyState: number = WebSocket.OPEN;
  send = vi.fn<(raw: string) => void>();
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
  });
  remoteClose(reason = "", code = 1006): void {
    this.readyState = WebSocket.CLOSED;
    const event = new Event("close");
    Object.assign(event, { code, reason });
    this.dispatchEvent(event);
  }
  fail(error: Error): void {
    const event = new Event("error");
    Object.assign(event, { error });
    this.dispatchEvent(event);
  }
}

const clients: CDPClient[] = [];
function connect() {
  const socket = new Socket();
  const client = new CDPClient(
    socket as unknown as WebSocket,
    "wss://browser.test?apiKey=connection-secret",
  );
  clients.push(client);
  return { socket, client };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("STAGEHAND_CDP_HEARTBEAT_MS", "20000");
  vi.stubEnv("STAGEHAND_CDP_LOG", "");
  vi.stubEnv("STAGEHAND_CDP_LOG_FILE", "");
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.resolve();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("CDP heartbeat lifecycle", () => {
  it("has at most one heartbeat pending and removes an unanswered heartbeat by its own deadline", async () => {
    const { client, socket } = connect();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.pending.size).toBe(1);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      method: "Browser.getVersion",
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(client.pending.size).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.pending.size).toBe(0);
    expect(client.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.pending.size).toBe(1);
    expect(socket.send).toHaveBeenCalledTimes(2);
  });

  it("uses the configured interval and does not retain the process", async () => {
    vi.stubEnv("STAGEHAND_CDP_HEARTBEAT_MS", "1000");
    const intervals = vi.spyOn(globalThis, "setInterval");
    const { client, socket } = connect();
    expect(intervals.mock.results[0]?.value.hasRef()).toBe(false);
    await vi.advanceTimersByTimeAsync(999);
    expect(socket.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.send).toHaveBeenCalledOnce();
    client.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(client.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["0", "999", "1000junk", "2147483648", "NaN"])(
    "falls back safely for invalid interval %s",
    async (raw) => {
      vi.stubEnv("STAGEHAND_CDP_HEARTBEAT_MS", raw);
      const { socket } = connect();
      await vi.advanceTimersByTimeAsync(19_999);
      expect(socket.send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.send).toHaveBeenCalledOnce();
    },
  );

  it("stops on a close and rejects subsequent commands even if a socket still reports OPEN", async () => {
    const { client, socket } = connect();
    const onclose = vi.fn();
    client.onclose = onclose;
    await vi.advanceTimersByTimeAsync(20_000);
    socket.remoteClose("remote ended", 1006);
    socket.readyState = WebSocket.OPEN;
    await expect(
      client.sendCommand("Page.navigate", { url: "https://example.test" }),
    ).rejects.toBeInstanceOf(CDPConnectionClosedError);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onclose).toHaveBeenCalledOnce();
    expect(client.pending.size).toBe(0);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the first socket error when closing emits a synchronous close event", async () => {
    const { client, socket } = connect();
    socket.close.mockImplementation(() => socket.remoteClose("cleanup"));
    const onerror = vi.fn();
    const onclose = vi.fn();
    client.onerror = onerror;
    client.onclose = onclose;
    const request = client.sendCommand("Runtime.evaluate");
    const rejected = expect(request).rejects.toMatchObject({ cause: new Error("socket failed") });
    socket.fail(new Error("socket failed"));
    await rejected;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onerror).toHaveBeenCalledOnce();
    expect(onclose).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops heartbeat after an invalid transport message", async () => {
    const { client, socket } = connect();
    const onerror = vi.fn();
    client.onerror = onerror;
    socket.dispatchEvent(new MessageEvent("message", { data: "invalid json" }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.closed).toBe(true);
    expect(onerror).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("logs sanitized nested socket causes once without changing the terminal error", async () => {
    vi.stubEnv("STAGEHAND_CDP_LOG", "1");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { client, socket } = connect();
    socket.close.mockImplementation(() => socket.remoteClose("cleanup"));
    const cause = new Error(
      "socket hang up wss://browser.test?apiKey=nested-secret sk-nested-secret Bearer bearer-secret",
    );
    const transport = new Error("WebSocket failed", { cause });
    const onerror = vi.fn();
    client.onerror = onerror;
    const request = client.sendCommand("Runtime.evaluate");
    const rejected = expect(request).rejects.toMatchObject({ cause: transport });
    socket.fail(transport);
    await rejected;
    expect(stderr).toHaveBeenCalledOnce();
    const output = String(stderr.mock.calls[0]![0]);
    const metadata = JSON.parse(output.slice("CDP_DROP ".length));
    expect(metadata).toMatchObject({
      kind: "error",
      code: null,
      pending: 1,
      last_method: "Runtime.evaluate",
      reason:
        "CDP connection closed: WebSocket failed: socket hang up [url] [redacted] Bearer [redacted]",
    });
    for (const secret of ["nested-secret", "sk-nested-secret", "bearer-secret"])
      expect(output).not.toContain(secret);
    expect(onerror).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ cause: transport }));
    expect(client.closed).toBe(true);
    expect(client.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds and redacts nested diagnostic text before truncating it", () => {
    vi.stubEnv("STAGEHAND_CDP_LOG", "1");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { socket } = connect();
    socket.fail(
      new Error("transport failed", {
        cause: new Error(`sk-${"s".repeat(300)} ${"detail ".repeat(50)}`),
      }),
    );
    const output = String(stderr.mock.calls[0]![0]);
    const metadata = JSON.parse(output.slice("CDP_DROP ".length));
    expect(metadata.reason).toHaveLength(160);
    expect(metadata.reason).toMatch(
      /^CDP connection closed: transport failed: \[redacted\] detail /u,
    );
    expect(output).not.toContain("ssss");
  });

  it.each(["cycle", "throwing getter", "unknown object"])(
    "keeps terminal cleanup and useful text when a nested cause is a %s",
    (kind) => {
      vi.stubEnv("STAGEHAND_CDP_LOG", "1");
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const { client, socket } = connect();
      const transport = new Error("transport failed");
      if (kind === "cycle") transport.cause = transport;
      else if (kind === "throwing getter")
        Object.defineProperty(transport, "cause", {
          get: () => {
            throw new Error("private getter");
          },
        });
      else
        transport.cause = {
          message: "private object",
          toString: () => {
            throw new Error("private stringifier");
          },
        };
      const onerror = vi.fn();
      client.onerror = onerror;
      socket.fail(transport);
      const output = String(stderr.mock.calls[0]![0]);
      const metadata = JSON.parse(output.slice("CDP_DROP ".length));
      expect(metadata.reason).toBe("CDP connection closed: transport failed");
      expect(output).not.toContain("private");
      expect(onerror).toHaveBeenCalledOnce();
      expect(client.closed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("writes sanitized metadata to stderr and the ESM file sink exactly once", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "cdp-diagnostic-"));
    const file = path.join(directory, "drop.jsonl");
    vi.stubEnv("STAGEHAND_CDP_LOG", "1");
    vi.stubEnv("STAGEHAND_CDP_LOG_FILE", file);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { client, socket } = connect();
      const request = client.sendCommand("Runtime.evaluate", { expression: "private payload" });
      const rejected = expect(request).rejects.toBeInstanceOf(CDPConnectionClosedError);
      await vi.advanceTimersByTimeAsync(50);
      socket.remoteClose(
        "https://example.test?token=reason-secret sk-secret123456 bb_live_secret123456 Bearer bearer-secret-value",
      );
      socket.remoteClose();
      await rejected;
      const output = await readFile(file, "utf8");
      expect(stderr).toHaveBeenCalledExactlyOnceWith(output);
      const metadata = JSON.parse(output.slice("CDP_DROP ".length));
      expect(metadata).toMatchObject({
        kind: "close",
        code: 1006,
        pending: 1,
        last_method: "Runtime.evaluate",
        age_ms: 50,
        idle_ms: 50,
      });
      for (const secret of [
        "connection-secret",
        "reason-secret",
        "private payload",
        "sk-secret123456",
        "bb_live_secret123456",
        "bearer-secret-value",
      ])
        expect(output).not.toContain(secret);
      expect(output).toContain("[redacted]");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
