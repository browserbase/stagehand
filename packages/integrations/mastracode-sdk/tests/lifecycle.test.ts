import { afterEach, describe, expect, it, vi } from "vitest";
import { StartupTimeoutError, createStartupDeadline, watchParent } from "../src/lifecycle.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createStartupDeadline", () => {
  it("passes results through while the budget lasts", async () => {
    const run = createStartupDeadline(1_000);
    await expect(run("a", Promise.resolve(1))).resolves.toBe(1);
    await expect(run("b", Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("rejects a phase that hangs past the shared budget, naming the phase", async () => {
    vi.useFakeTimers();
    const run = createStartupDeadline(1_000);
    const hung = run("mcp_connect", new Promise(() => undefined));
    const assertion = expect(hung).rejects.toMatchObject({
      name: "StartupTimeoutError",
      phase: "mcp_connect",
      message: "mastracode startup timed out after 1000 ms (mcp_connect)",
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it("charges earlier phases against the same budget", async () => {
    let clock = 0;
    const run = createStartupDeadline(1_000, () => clock);
    await run("createMastraCode", Promise.resolve());
    clock = 1_000;
    await expect(run("model_switch", Promise.resolve())).rejects.toBeInstanceOf(
      StartupTimeoutError,
    );
  });
});

describe("watchParent", () => {
  it("fires once when the driver is reparented", async () => {
    vi.useFakeTimers();
    let ppid = 100;
    const onGone = vi.fn();
    watchParent({ originalPpid: 100, getPpid: () => ppid, probe: () => undefined, onGone });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(onGone).not.toHaveBeenCalled();
    ppid = 1;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("fires when the original pid no longer exists", async () => {
    vi.useFakeTimers();
    const onGone = vi.fn();
    watchParent({
      originalPpid: 100,
      getPpid: () => 100,
      probe: () => {
        throw Object.assign(new Error("no such process"), { code: "ESRCH" });
      },
      onGone,
      intervalMs: 500,
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("treats EPERM as alive and stops polling when stopped", async () => {
    vi.useFakeTimers();
    const onGone = vi.fn();
    const probe = vi.fn(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });
    const stop = watchParent({ originalPpid: 100, getPpid: () => 100, probe, onGone });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onGone).not.toHaveBeenCalled();
    stop();
    const calls = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probe.mock.calls.length).toBe(calls);
  });
});
