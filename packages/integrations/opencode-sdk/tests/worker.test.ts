import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenCode } from "@opencode/sdk";
import { executeOpenCodeSession, interruptOpenCodeSession } from "../src/worker.js";
import type { OpenCodeSessionConfig } from "../src/session.js";

vi.mock("@opencode/sdk", () => ({ OpenCode: { create: vi.fn() } }));
vi.mock("@opencode/plugin", () => ({ Plugin: { define: (value: unknown) => value } }));

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "stagehand-opencode-worker-test-"));
  roots.push(root);
  const session: OpenCodeSessionConfig = {
    directory: join(root, "workspace"),
    configRoot: join(root, "config"),
    config: {
      mcp: { servers: {} },
      permissions: [{ action: "*", resource: "*", effect: "deny" }],
    },
  };
  const host = {
    sessions: {
      create: vi.fn(async () => ({ id: "session-1" })),
      switchModel: vi.fn(async () => undefined),
      prompt: vi.fn(async () => ({ accepted: true })),
      wait: vi.fn(async () => undefined),
      get: vi.fn(async () => ({
        outcome: "succeeded",
        cost: 0.02,
        tokens: { input: 7, output: 3, reasoning: 1 },
      })),
      interrupt: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
    message: {
      list: vi
        .fn()
        .mockResolvedValueOnce({
          data: [{ type: "assistant", content: [{ type: "text", text: "first" }] }],
          cursor: { next: "page-2" },
        })
        .mockResolvedValueOnce({
          data: [{ type: "assistant", content: [{ type: "text", text: "done" }] }],
          cursor: {},
        }),
    },
    close: vi.fn(async () => undefined),
  };
  vi.mocked(OpenCode.create).mockResolvedValue(host as never);
  return { session, host };
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenCode v2 worker lifecycle", () => {
  it("waits beyond prompt admission, selects a model, reads every page, and cleans up", async () => {
    const { session, host } = await fixture();
    const result = await executeOpenCodeSession({
      prompt: "browse",
      model: "openai/gpt-5.4-mini",
      session,
    });
    expect(host.sessions.switchModel).toHaveBeenCalledWith({
      sessionID: "session-1",
      model: { providerID: "openai", id: "gpt-5.4-mini" },
    });
    expect(host.sessions.prompt).toHaveBeenCalledWith({ sessionID: "session-1", text: "browse" });
    expect(host.sessions.wait).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(host.message.list).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "completed", finalMessage: "done", costUsd: 0.02 });
    expect(result.messages).toHaveLength(2);
    expect(result.tokenUsage.totalTokens).toBe(11);
    expect(host.sessions.remove).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(host.close).toHaveBeenCalledOnce();
  });

  it("reports idle failure and still removes the session", async () => {
    const { session, host } = await fixture();
    host.sessions.get.mockResolvedValue({
      outcome: "failed",
      cost: 0,
      tokens: { input: 2, output: 0, reasoning: 0 },
    });
    const result = await executeOpenCodeSession({
      prompt: "browse",
      model: "opencode/auto",
      session,
    });
    expect(host.sessions.switchModel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "sdk_error", stopReason: "failed" });
    expect(host.sessions.remove).toHaveBeenCalledOnce();
    expect(host.close).toHaveBeenCalledOnce();
  });

  it("closes the host after prompt errors", async () => {
    const { session, host } = await fixture();
    host.sessions.prompt.mockRejectedValue(new Error("provider unavailable"));
    await expect(
      executeOpenCodeSession({ prompt: "browse", model: "opencode/auto", session }),
    ).rejects.toThrow("provider unavailable");
    expect(host.sessions.remove).toHaveBeenCalledOnce();
    expect(host.close).toHaveBeenCalledOnce();
  });

  it("interrupts an active session on cancellation and cleans it up", async () => {
    const { session, host } = await fixture();
    let releaseWait: (() => void) | undefined;
    let reachedWait: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      reachedWait = resolve;
    });
    host.sessions.wait.mockImplementation(() => {
      reachedWait?.();
      return new Promise<void>((resolve) => {
        releaseWait = resolve;
      });
    });
    host.sessions.get.mockResolvedValue({
      outcome: "interrupted",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0 },
    });
    const run = executeOpenCodeSession({ prompt: "browse", model: "opencode/auto", session });
    await waiting;
    interruptOpenCodeSession();
    releaseWait?.();
    const result = await run;
    expect(result).toMatchObject({ status: "sdk_error", stopReason: "interrupted" });
    expect(host.sessions.interrupt).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(host.sessions.remove).toHaveBeenCalledOnce();
    expect(host.close).toHaveBeenCalledOnce();
  });
});
