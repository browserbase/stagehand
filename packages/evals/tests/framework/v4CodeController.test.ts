import { EventEmitter } from "node:events";
import type { ChildProcess, ForkOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  startV4CodeController,
  stringifyV4CodeConsoleValue,
  type V4CodeBridgeConsoleEvent,
  type V4CodeBridgeFork,
  type V4CodeBridgeRequest,
  type V4CodeBridgeResponse,
} from "../../framework/v4CodeController.js";
import { STAGEHAND_V4_SDK_PATH_ENV } from "../../framework/v4CodeConfig.js";

class FakeBridgeChild extends EventEmitter {
  connected = true;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly sent: V4CodeBridgeRequest[] = [];
  disconnectCalls = 0;
  killCalls: Array<NodeJS.Signals | number | undefined> = [];
  onRequest?: (request: V4CodeBridgeRequest) => void;

  send(
    message: V4CodeBridgeRequest,
    callback?: (error: Error | null) => void,
  ): boolean {
    this.sent.push(message);
    queueMicrotask(() => {
      callback?.(null);
      this.onRequest?.(message);
    });
    return true;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    if (!this.connected) return;
    this.connected = false;
    queueMicrotask(() => this.exit(0, null));
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killCalls.push(signal);
    this.killed = true;
    this.exit(null, typeof signal === "string" ? signal : "SIGTERM");
    return true;
  }

  respond(response: V4CodeBridgeResponse | V4CodeBridgeConsoleEvent): void {
    this.emit("message", response);
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.connected = false;
    this.emit("exit", code, signal);
  }
}

function makeFork(child: FakeBridgeChild): {
  forkProcess: V4CodeBridgeFork;
  calls: Array<{
    modulePath: string;
    args: readonly string[];
    options: ForkOptions;
  }>;
} {
  const calls: Array<{
    modulePath: string;
    args: readonly string[];
    options: ForkOptions;
  }> = [];
  return {
    calls,
    forkProcess: (modulePath, args, options) => {
      calls.push({ modulePath, args, options });
      return child as unknown as ChildProcess;
    },
  };
}

function respondSuccessfully(child: FakeBridgeChild): void {
  child.onRequest = (request) => {
    if (request.type === "execute") {
      child.respond({
        id: request.id,
        ok: true,
        result: { title: "Example Domain" },
      });
      return;
    }
    child.respond({ id: request.id, ok: true });
  };
}

describe("V4 code child controller", () => {
  it("initializes, executes by request ID, and closes exactly once", async () => {
    const child = new FakeBridgeChild();
    respondSuccessfully(child);
    const { forkProcess, calls } = makeFork(child);

    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });
    const result = await controller.execute({
      code: "return await page.title();",
      startUrl: "https://example.com",
      task: { id: "smoke" },
    });
    const initRequest = child.sent[0];
    expect(initRequest.type).toBe("init");
    if (initRequest.type !== "init") throw new Error("Expected init request");
    expect(initRequest.userDataDir?.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(initRequest.userDataDir ?? "")).toBe(true);
    await controller.close();
    await controller.close();

    expect(result).toEqual({ title: "Example Domain" });
    expect(child.sent.map((request) => request.type)).toEqual([
      "init",
      "execute",
      "close",
    ]);
    expect(new Set(child.sent.map((request) => request.id)).size).toBe(3);
    expect(child.disconnectCalls).toBe(1);
    expect(child.killCalls).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      modulePath: "/synthetic/v4CodeBridge.ts",
      args: [],
      options: {
        detached: process.platform !== "win32",
        execArgv: ["--import", expect.stringContaining("tsx")],
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    });
    expect(calls[0].options.env?.[STAGEHAND_V4_SDK_PATH_ENV]).toBeUndefined();
    expect(fs.existsSync(initRequest.userDataDir ?? "")).toBe(false);
  });

  it("serializes console values without dropping undefined", () => {
    expect(stringifyV4CodeConsoleValue("text")).toBe("text");
    expect(stringifyV4CodeConsoleValue({ ok: true })).toBe('{"ok":true}');
    expect(stringifyV4CodeConsoleValue(undefined)).toBe("undefined");
    expect(stringifyV4CodeConsoleValue(1n)).toBe("1");
  });

  it("can inherit child stdout and stderr for V4 debugging", async () => {
    const child = new FakeBridgeChild();
    respondSuccessfully(child);
    const { forkProcess, calls } = makeFork(child);

    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      inheritChildLogs: true,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });
    await controller.close();

    expect(calls[0].options.stdio).toEqual([
      "ignore",
      "inherit",
      "inherit",
      "ipc",
    ]);
  });

  it("sets the bridge cwd and forwards typed snippet console events", async () => {
    const child = new FakeBridgeChild();
    respondSuccessfully(child);
    const { forkProcess, calls } = makeFork(child);
    const onConsole = vi.fn();

    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      workingDirectory: os.tmpdir(),
      onConsole,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });
    child.respond({
      type: "console",
      requestId: 2,
      level: "log",
      message: "visible through IPC",
    });
    await controller.close();

    expect(calls[0].options.cwd).toBe(os.tmpdir());
    expect(child.sent[0]).toMatchObject({
      type: "init",
      userDataDir: path.join(os.tmpdir(), "v4-browser-profile"),
    });
    expect(onConsole).toHaveBeenCalledWith({
      type: "console",
      requestId: 2,
      level: "log",
      message: "visible through IPC",
    });
  });

  it("returns child execution errors without poisoning later requests", async () => {
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      if (request.type === "init" || request.type === "close") {
        child.respond({ id: request.id, ok: true });
        return;
      }
      child.respond({
        id: request.id,
        ok: false,
        error: { name: "TypeError", message: "page method failed" },
      });
    };
    const { forkProcess } = makeFork(child);
    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });

    await expect(
      controller.execute({ code: "throw new Error()", startUrl: "", task: {} }),
    ).rejects.toThrow("V4 code bridge execute failed: page method failed");
    await controller.close();
  });

  it("terminates the child when initialization fails", async () => {
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      child.respond({
        id: request.id,
        ok: false,
        error: { name: "Error", message: "schema registration failed" },
      });
    };
    const { forkProcess } = makeFork(child);

    await expect(
      startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      }),
    ).rejects.toThrow("V4 code bridge init failed: schema registration failed");
    expect(child.sent.map((request) => request.type)).toEqual(["init"]);
    expect(child.disconnectCalls).toBe(1);
  });

  it("rejects pending work when the child exits unexpectedly", async () => {
    const child = new FakeBridgeChild();
    child.onRequest = (request) => {
      if (request.type === "init") {
        child.respond({ id: request.id, ok: true });
        return;
      }
      if (request.type === "execute") child.exit(17, null);
    };
    const { forkProcess } = makeFork(child);
    const controller = await startV4CodeController({
      sdkPath: "/synthetic/v4-sdk.ts",
      bridgePath: "/synthetic/v4CodeBridge.ts",
      forkProcess,
      startupTimeoutMs: 100,
      executeTimeoutMs: 100,
      closeTimeoutMs: 100,
    });

    await expect(
      controller.execute({ code: "return 1", startUrl: "", task: {} }),
    ).rejects.toThrow(
      "V4 code bridge exited unexpectedly (code=17, signal=null)",
    );
    await controller.close();
  });

  it("kills the recorded Chrome process group after an unexpected bridge exit", async () => {
    if (process.platform === "win32") return;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type === "init") {
          child.respond({
            id: request.id,
            ok: true,
            result: { browserPid: 424_242 },
          });
          return;
        }
        if (request.type === "execute") child.exit(17, null);
      };
      const { forkProcess } = makeFork(child);
      const controller = await startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      });

      await expect(
        controller.execute({ code: "return 1", startUrl: "", task: {} }),
      ).rejects.toThrow("V4 code bridge exited unexpectedly");
      expect(kill).toHaveBeenCalledWith(-424_242, "SIGKILL");
      await controller.close();
    } finally {
      kill.mockRestore();
    }
  });

  it("kills Chrome when the bridge exits before acknowledging close", async () => {
    if (process.platform === "win32") return;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type === "init") {
          child.respond({
            id: request.id,
            ok: true,
            result: { browserPid: 424_243 },
          });
          return;
        }
        if (request.type === "close") child.exit(19, null);
      };
      const { forkProcess } = makeFork(child);
      const controller = await startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 100,
        closeTimeoutMs: 100,
      });

      await expect(controller.close()).rejects.toThrow(
        "V4 code bridge exited unexpectedly",
      );
      expect(kill).toHaveBeenCalledWith(-424_243, "SIGKILL");
    } finally {
      kill.mockRestore();
    }
  });

  it("kills Chrome discovered from its PID file when initialization aborts", async () => {
    if (process.platform === "win32") return;
    const workingDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "v4-controller-abort-"),
    );
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type !== "init") return;
        fs.writeFileSync(
          path.join(workingDirectory, "v4-browser-profile", "chrome.pid"),
          "424244",
        );
        child.respond({
          id: request.id,
          ok: false,
          error: { name: "Error", message: "init failed after launch" },
        });
      };
      const { forkProcess } = makeFork(child);

      await expect(
        startV4CodeController({
          sdkPath: "/synthetic/v4-sdk.ts",
          bridgePath: "/synthetic/v4CodeBridge.ts",
          forkProcess,
          workingDirectory,
          startupTimeoutMs: 100,
          executeTimeoutMs: 100,
          closeTimeoutMs: 100,
        }),
      ).rejects.toThrow("init failed after launch");
      expect(kill).toHaveBeenCalledWith(-424_244, "SIGKILL");
    } finally {
      kill.mockRestore();
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("times out execution and tears down the child", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeBridgeChild();
      child.onRequest = (request) => {
        if (request.type === "init") {
          child.respond({ id: request.id, ok: true });
        }
      };
      const { forkProcess } = makeFork(child);
      const controllerPromise = startV4CodeController({
        sdkPath: "/synthetic/v4-sdk.ts",
        bridgePath: "/synthetic/v4CodeBridge.ts",
        forkProcess,
        startupTimeoutMs: 100,
        executeTimeoutMs: 25,
        closeTimeoutMs: 100,
      });
      await vi.runAllTicks();
      const controller = await controllerPromise;
      const execution = controller.execute({
        code: "return new Promise(() => {})",
        startUrl: "",
        task: {},
      });
      const rejection = expect(execution).rejects.toThrow(
        "V4 code bridge execute timed out after 25ms",
      );
      await vi.advanceTimersByTimeAsync(25);

      await rejection;
      expect(child.disconnectCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
