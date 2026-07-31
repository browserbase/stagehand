import { describe, expect, it, vi } from "vitest";
import { CodeSessionManager } from "../src/session-manager.js";
import { CodeModeRuntimeError } from "../src/types.js";
import type { CodeRuntime } from "../src/types.js";

function fakeRuntime(): CodeRuntime {
  let url = "about:blank";
  return {
    async run(code) {
      if (code.includes("navigate")) url = "https://example.com/";
      return {
        value: { code, url },
        logs: [],
        page: { url, title: url === "about:blank" ? "" : "Example Domain" },
      };
    },
    async status() {
      return { state: "ready", page: { url, title: "" } };
    },
    async reset() {
      url = "about:blank";
    },
    async close() {},
  };
}

describe("CodeSessionManager", () => {
  it("does not create a runtime until the first run", async () => {
    const runtimeFactory = vi.fn(fakeRuntime);
    const manager = new CodeSessionManager({ runtimeFactory });

    await expect(manager.execute({ action: "status" })).resolves.toMatchObject({
      ok: true,
      state: "idle",
      active_code_sessions: 0,
    });
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it("reuses one long-lived runtime for calls with the same opaque session ID", async () => {
    const runtimeFactory = vi.fn(fakeRuntime);
    const manager = new CodeSessionManager({
      runtimeFactory,
      sessionIdFactory: () => "code_test",
    });

    const first = await manager.execute({ action: "run", code: "navigate" });
    expect(first).toMatchObject({
      ok: true,
      code_session_id: "code_test",
      value: { url: "https://example.com/" },
    });
    const second = await manager.execute({
      action: "run",
      code_session_id: "code_test",
      code: "read",
    });
    expect(second).toMatchObject({
      ok: true,
      code_session_id: "code_test",
      value: { url: "https://example.com/" },
    });
    expect(runtimeFactory).toHaveBeenCalledTimes(1);
  });

  it("closes and removes a session only when explicitly requested", async () => {
    const runtime = fakeRuntime();
    const close = vi.spyOn(runtime, "close");
    const manager = new CodeSessionManager({
      runtimeFactory: () => runtime,
      sessionIdFactory: () => "code_test",
    });
    await manager.execute({ action: "run", code: "navigate" });
    await manager.execute({
      action: "status",
      code_session_id: "code_test",
    });
    expect(close).not.toHaveBeenCalled();

    await expect(
      manager.execute({ action: "close", code_session_id: "code_test" }),
    ).resolves.toMatchObject({ ok: true, state: "closed" });
    expect(close).toHaveBeenCalledOnce();
    expect(manager.activeSessionCount).toBe(0);
  });

  it("does not expose runtime stack traces in model-visible failures", async () => {
    const manager = new CodeSessionManager({
      runtimeFactory: () => ({
        ...fakeRuntime(),
        async run() {
          throw new Error("synthetic failure");
        },
      }),
      sessionIdFactory: () => "code_test",
    });

    const result = await manager.execute({ action: "run", code: "throw" });
    expect(result).toMatchObject({
      ok: false,
      error: { message: "synthetic failure" },
    });
    if (result.ok) throw new Error("Expected a failure result.");
    expect(result.error).not.toHaveProperty("stack");
  });

  it("marks uncertain timeout failures as unsafe to retry", async () => {
    const manager = new CodeSessionManager({
      runtimeFactory: () => ({
        ...fakeRuntime(),
        async run() {
          throw new CodeModeRuntimeError("timeout", "cell timed out", false, {
            mayHaveSideEffects: true,
          });
        },
      }),
      sessionIdFactory: () => "code_test",
    });

    const result = await manager.execute({ action: "run", code: "slow mutation" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "timeout",
        retryable: false,
        may_have_side_effects: true,
      },
    });
  });

  it("does not leak a new logical session when its request is already aborted", async () => {
    const runtimeFactory = vi.fn(fakeRuntime);
    const manager = new CodeSessionManager({
      runtimeFactory,
      sessionIdFactory: () => "code_aborted",
    });
    const controller = new AbortController();
    controller.abort("caller disconnected");

    const result = await manager.execute({ action: "run", code: "return true" }, controller.signal);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "aborted", retryable: false },
    });
    expect(runtimeFactory).not.toHaveBeenCalled();
    expect(manager.activeSessionCount).toBe(0);
  });
});
