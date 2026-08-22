/* eslint-disable require-yield */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { HarnessAdapterError } from "@browserbasehq/stagehand-integrations/harness";
import {
  parseEveDevServerUrl,
  runEveSession,
  startEveDevServer,
  type EveClientLike,
  type EveEvent,
} from "../src/index.js";

const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

function response(events: EveEvent[], sessionId = "session-1") {
  return Object.assign(
    {
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    },
    { sessionId },
  );
}

function clientFor(events: EveEvent[]) {
  const cancel = vi.fn(async () => ({}));
  const send = vi.fn(async (_input: { message: string; signal?: AbortSignal }) => response(events));
  const client: EveClientLike = {
    health: vi.fn(async () => ({})),
    session: () => ({ send, cancel }),
  };
  return { client, send, cancel };
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 1234;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  return child;
}

describe("Eve SDK session", () => {
  it("parses only the dev server ready line", () => {
    expect(parseEveDevServerUrl("☰eve  v0.29.4")).toBeUndefined();
    expect(parseEveDevServerUrl("[DEV] server listening at http://127.0.0.1:61439/")).toBe(
      "http://127.0.0.1:61439",
    );
  });

  it("starts the dev server, sanitizes logs, and passes CLI options", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const pending = startEveDevServer({
      appRoot: "/tmp/eve-app",
      env: { PATH: "/bin" },
      logger,
      eveBinPath: "/tmp/eve.js",
      spawn: spawn as unknown as Parameters<typeof startEveDevServer>[0]["spawn"],
    });
    child.stdout.write("token sk-abc123SUPERSECRET\n");
    child.stdout.write("[DEV] server listening at http://127.0.0.1:61439/\n");
    const handle = await pending;

    expect(handle.url).toBe("http://127.0.0.1:61439");
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ["/tmp/eve.js", "dev", "--no-ui", "--port", "0"],
      expect.objectContaining({ cwd: "/tmp/eve-app" }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("sk-abc123[redacted]") }),
    );
  });

  it("reports a sanitized output tail on early exit", async () => {
    const child = fakeChild();
    const pending = startEveDevServer({
      appRoot: "/tmp/eve-app",
      env: {},
      logger,
      eveBinPath: "/tmp/eve.js",
      spawn: (() => child) as unknown as Parameters<typeof startEveDevServer>[0]["spawn"],
    });
    child.stderr.write("failed with sk-abc123SUPERSECRET\n");
    child.exitCode = 1;
    child.emit("exit", 1, null);

    const error = await pending.catch((value) => value);
    expect(error).toBeInstanceOf(HarnessAdapterError);
    expect(String(error.message)).toContain("sk-abc123[redacted]");
    expect(String(error.message)).not.toContain("SUPERSECRET");
  });

  it("closes the dev server with SIGTERM and waits for exit", async () => {
    const child = fakeChild();
    const pending = startEveDevServer({
      appRoot: "/tmp/eve-app",
      env: {},
      logger,
      eveBinPath: "/tmp/eve.js",
      spawn: (() => child) as unknown as Parameters<typeof startEveDevServer>[0]["spawn"],
    });
    child.stdout.write("[DEV] server listening at http://127.0.0.1:61439\n");
    const handle = await pending;
    const closing = handle.close();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.exitCode = 0;
    child.emit("exit", 0, null);
    await closing;
  });

  it("collects a completed turn, tool callbacks, usage, cost, and session id", async () => {
    const onToolStep = vi.fn();
    const onToolResult = vi.fn();
    const { client } = clientFor([
      {
        type: "actions.requested",
        data: { actions: [{ kind: "tool-call", callId: "1", toolName: "stagehand__run" }] },
      },
      {
        type: "action.result",
        data: {
          status: "completed",
          result: { kind: "tool-result", callId: "1", toolName: "stagehand__run" },
        },
      },
      {
        type: "step.completed",
        data: {
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            cacheReadTokens: 2,
            cacheWriteTokens: 1,
            costUsd: 0.01,
          },
        },
      },
      {
        type: "step.completed",
        data: { usage: { inputTokens: 5, outputTokens: 3, costUsd: "0.02" } },
      },
      { type: "message.completed", data: { message: "done" } },
      { type: "turn.completed" },
    ]);
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve/" },
      client,
      onToolStep,
      onToolResult,
    });

    expect(result).toMatchObject({
      finalMessage: "done",
      status: "completed",
      sessionId: "session-1",
      serverUrl: "http://eve",
      tokenUsage: {
        inputTokens: 15,
        outputTokens: 7,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        totalTokens: 25,
        costUsd: 0.03,
      },
    });
    expect(onToolStep).toHaveBeenCalledWith("stagehand__run");
    expect(onToolResult).toHaveBeenCalledWith("stagehand__run");
  });

  it("omits cost when no completed step reports it", async () => {
    const { client } = clientFor([
      { type: "step.completed", data: { usage: { inputTokens: 1 } } },
      { type: "turn.completed" },
    ]);
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client,
    });
    expect(result.tokenUsage).not.toHaveProperty("costUsd");
  });

  it("sanitizes turn failures", async () => {
    const { client } = clientFor([
      { type: "turn.failed", data: { message: "bad sk-abc123SUPERSECRET" } },
    ]);
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client,
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("sk-abc123[redacted]");
    expect(result.stopReason).not.toContain("SUPERSECRET");
  });

  it("cancels when the tool-step budget is exhausted", async () => {
    const setup = clientFor([
      {
        type: "actions.requested",
        data: { actions: [{ kind: "tool-call", callId: "1", toolName: "stagehand__run" }] },
      },
    ]);
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client: setup.client,
      maxToolSteps: 1,
    });
    expect(setup.cancel).toHaveBeenCalledOnce();
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toContain("budget exhausted");
  });

  it("cancels and errors when Eve requests human input", async () => {
    const setup = clientFor([
      { type: "input.requested", data: { requests: [{ kind: "question" }] } },
    ]);
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client: setup.client,
    });
    expect(setup.cancel).toHaveBeenCalledOnce();
    expect(result.status).toBe("sdk_error");
  });

  it("forwards caller aborts to send", async () => {
    const setup = clientFor([{ type: "turn.completed" }]);
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      signal: controller.signal,
      server: { url: "http://eve" },
      client: setup.client,
    });
    expect(setup.send.mock.calls[0]?.[0].signal).toMatchObject({ aborted: true });
  });

  it("errors when the stream ends without a turn boundary", async () => {
    const { client } = clientFor([{ type: "message.completed", data: { message: "partial" } }]);
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client,
    });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("without a turn boundary");
  });

  it("reports health failures as iteration errors", async () => {
    const client: EveClientLike = {
      health: vi.fn(async () => {
        throw new Error("health failed");
      }),
      session: vi.fn(),
    };
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client,
    });
    expect(result.status).toBe("sdk_error");
    expect(String(result.iterationError)).toContain("health failed");
  });
});
