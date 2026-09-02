/* eslint-disable require-yield */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { HarnessAdapterError } from "@browserbasehq/stagehand-integrations/harness";
import {
  logEveEvent,
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

  it("keeps only the last 20 dev-server output lines in startup errors", async () => {
    const child = fakeChild();
    const pending = startEveDevServer({
      appRoot: "/tmp/eve-app",
      env: {},
      logger,
      eveBinPath: "/tmp/eve.js",
      spawn: (() => child) as unknown as Parameters<typeof startEveDevServer>[0]["spawn"],
    });
    for (let index = 1; index <= 25; index += 1) child.stderr.write(`output-${index}\n`);
    child.exitCode = 1;
    child.emit("exit", 1, null);

    const error = await pending.catch((value) => value);
    expect(String(error.message)).not.toContain("output-5\n");
    expect(String(error.message)).toContain("output-6\n");
    expect(String(error.message)).toContain("output-25");
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

  it("clears the graceful shutdown timer after the child exits", async () => {
    vi.useFakeTimers();
    try {
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
      child.exitCode = 0;
      child.emit("exit", 0, null);

      await closing;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
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

  it("executes and records one tool result before exhausting a one-step budget", async () => {
    const setup = clientFor([
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
        type: "actions.requested",
        data: { actions: [{ kind: "tool-call", callId: "2", toolName: "stagehand__run" }] },
      },
    ]);
    const onToolStep = vi.fn(() => expect(setup.cancel).not.toHaveBeenCalled());
    const onToolResult = vi.fn(() => expect(setup.cancel).not.toHaveBeenCalled());
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client: setup.client,
      maxToolSteps: 1,
      onToolStep,
      onToolResult,
    });
    expect(onToolStep).toHaveBeenCalledOnce();
    expect(onToolResult).toHaveBeenCalledOnce();
    expect(result.events.filter((event) => event.type === "action.result")).toHaveLength(1);
    expect(setup.cancel).toHaveBeenCalledOnce();
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toContain("budget exhausted");
  });

  it("records two tool results before exhausting a two-step budget", async () => {
    const setup = clientFor([
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
        type: "actions.requested",
        data: { actions: [{ kind: "tool-call", callId: "2", toolName: "stagehand__run" }] },
      },
      {
        type: "action.result",
        data: {
          status: "completed",
          result: { kind: "tool-result", callId: "2", toolName: "stagehand__run" },
        },
      },
      { type: "message.completed", data: { message: "should not be read" } },
    ]);
    const onToolResult = vi.fn(() => expect(setup.cancel).not.toHaveBeenCalled());
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client: setup.client,
      maxToolSteps: 2,
      onToolResult,
    });

    expect(onToolResult).toHaveBeenCalledTimes(2);
    expect(result.events.filter((event) => event.type === "action.result")).toHaveLength(2);
    expect(result.events.at(-1)?.type).toBe("action.result");
    expect(setup.cancel).toHaveBeenCalledOnce();
    expect(result.status).toBe("max_turns");
    expect(result.stopReason).toContain("budget exhausted");
  });

  it("does not count failed tool results against the completed-step budget", async () => {
    const setup = clientFor([
      {
        type: "action.result",
        data: {
          status: "failed",
          result: {
            kind: "tool-result",
            toolName: "stagehand__run",
            isError: true,
          },
        },
      },
      {
        type: "action.result",
        data: {
          status: "completed",
          result: { kind: "tool-result", toolName: "stagehand__run" },
        },
      },
    ]);
    const onToolResult = vi.fn();
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client: setup.client,
      maxToolSteps: 1,
      onToolResult,
    });

    expect(onToolResult).toHaveBeenCalledTimes(2);
    expect(result.events).toHaveLength(2);
    expect(setup.cancel).toHaveBeenCalledOnce();
    expect(result.status).toBe("max_turns");
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

  it("reports a pre-aborted caller signal as a sanitized SDK error", async () => {
    const setup = clientFor([{ type: "turn.completed" }]);
    const controller = new AbortController();
    controller.abort(new Error("stop sk-abc123SUPERSECRET"));
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      signal: controller.signal,
      server: { url: "http://eve" },
      client: setup.client,
    });
    expect(setup.send.mock.calls[0]?.[0].signal).toMatchObject({ aborted: true });
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("stop sk-abc123[redacted]");
    expect(result.stopReason).not.toContain("SUPERSECRET");
  });

  it("cancels exactly once when the caller aborts mid-stream", async () => {
    const controller = new AbortController();
    let releaseStream: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    let firstEventSeen: (() => void) | undefined;
    const sawFirstEvent = new Promise<void>((resolve) => {
      firstEventSeen = resolve;
    });
    const cancel = vi.fn(async () => ({}));
    const client: EveClientLike = {
      health: vi.fn(async () => ({})),
      session: () => ({
        cancel,
        send: vi.fn(async () =>
          Object.assign(
            {
              async *[Symbol.asyncIterator]() {
                yield {
                  type: "actions.requested",
                  data: { actions: [{ kind: "tool-call", toolName: "stagehand__act" }] },
                };
                await blocked;
                yield { type: "turn.completed" };
              },
            },
            { sessionId: "session-1" },
          ),
        ),
      }),
    };
    const pending = runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      signal: controller.signal,
      server: { url: "http://eve" },
      client,
      onToolStep: () => firstEventSeen?.(),
    });
    await sawFirstEvent;
    controller.abort(new Error("bench timeout sk-abc123SUPERSECRET"));
    releaseStream?.();

    const result = await pending;
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.status).toBe("sdk_error");
    expect(result.stopReason).toContain("bench timeout sk-abc123[redacted]");
    expect(result.stopReason).not.toContain("SUPERSECRET");
  });

  it("kills the generated dev server and cancels Eve on a mid-stream abort", async () => {
    const child = fakeChild();
    let childKilled: (() => void) | undefined;
    const killed = new Promise<void>((resolve) => {
      childKilled = resolve;
    });
    child.kill.mockImplementation(() => {
      childKilled?.();
      return true;
    });
    const controller = new AbortController();
    let releaseStream: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    let streamStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve;
    });
    const cancel = vi.fn(async () => ({}));
    const client: EveClientLike = {
      health: vi.fn(async () => ({})),
      session: () => ({
        cancel,
        send: vi.fn(async () =>
          Object.assign(
            {
              async *[Symbol.asyncIterator]() {
                streamStarted?.();
                await blocked;
                if (controller.signal.aborted) throw controller.signal.reason;
              },
            },
            { sessionId: "session-1" },
          ),
        ),
      }),
    };
    const pending = runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      signal: controller.signal,
      server: {
        appRoot: "/tmp/eve-app",
        env: {},
        eveBinPath: "/tmp/eve.js",
        spawn: (() => child) as unknown as NonNullable<
          Extract<Parameters<typeof runEveSession>[0]["server"], { appRoot: string }>["spawn"]
        >,
      },
      client,
    });
    child.stdout.write("[DEV] server listening at http://127.0.0.1:61439/\n");
    await started;
    controller.abort(new Error("bench timeout"));
    releaseStream?.();
    await killed;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(cancel).toHaveBeenCalledOnce();
    child.exitCode = 0;
    child.emit("exit", 0, null);

    const result = await pending;
    expect(result.status).toBe("sdk_error");
  });

  it("redacts event messages and persisted event details", () => {
    const eventLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logEveEvent(eventLogger, {
      type: "action.result",
      data: {
        status: "completed",
        result: { kind: "tool-result", toolName: "act", output: "sk-abc123SUPERSECRET" },
      },
    });
    logEveEvent(eventLogger, {
      type: "authorization.requested",
      data: { challenge: "Bearer aaaaaaaaaaaaaaaaaaaa" },
    });
    logEveEvent(eventLogger, {
      type: "message.completed",
      data: { message: "answer sk-abc123SUPERSECRET" },
    });

    const serialized = JSON.stringify(eventLogger.log.mock.calls);
    expect(serialized).toContain("sk-abc123[redacted]");
    expect(serialized).toContain("Bearer [redacted]");
    expect(serialized).not.toContain("SUPERSECRET");
    expect(serialized).not.toContain("aaaaaaaaaaaaaaaaaaaa");
    expect(eventLogger.log.mock.calls[0]?.[0]).toMatchObject({
      auxiliary: { detail: { value: expect.stringContaining("sk-abc123[redacted]") } },
    });
    expect(eventLogger.log.mock.calls[1]?.[0]).toMatchObject({
      auxiliary: { detail: { value: expect.stringContaining("Bearer [redacted]") } },
    });
    expect(eventLogger.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("sk-abc123[redacted]"),
        auxiliary: expect.objectContaining({
          detail: expect.objectContaining({
            value: expect.stringContaining("sk-abc123[redacted]"),
          }),
        }),
      }),
    );
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

  it("reports health failures as fixed typed iteration errors", async () => {
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
    expect(result.iterationError).toBeInstanceOf(HarnessAdapterError);
    expect(String(result.iterationError)).toBe("HarnessAdapterError: Eve session failed.");
    expect(JSON.stringify(result.iterationError)).not.toContain("health failed");
  });

  it("cancels the Eve session when a tool callback throws", async () => {
    const setup = clientFor([
      {
        type: "action.result",
        data: {
          status: "completed",
          result: { kind: "tool-result", toolName: "stagehand__run" },
        },
      },
    ]);
    const result = await runEveSession({
      prompt: "task",
      model: "gpt",
      logger,
      server: { url: "http://eve" },
      client: setup.client,
      onToolResult: () => {
        throw new Error("callback leaked sk-abc123SUPERSECRET");
      },
    });

    expect(setup.cancel).toHaveBeenCalledOnce();
    expect(result.iterationError).toBeInstanceOf(HarnessAdapterError);
    expect(JSON.stringify(result)).not.toContain("SUPERSECRET");
  });
});
