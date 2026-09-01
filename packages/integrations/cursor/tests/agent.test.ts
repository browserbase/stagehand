import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonlLocalAgentStore } from "@cursor/sdk";
import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";

import {
  buildAllowlistedEnv,
  buildCursorAgentOptions,
  buildCursorPrompt,
  CursorInterruptionError,
  resolveInstruction,
  runCursor,
  type CursorRuntimeAgent,
  type CursorRuntimeRun,
} from "../src/agent.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("cursor stagehand example", () => {
  it("forwards only non-empty Stagehand and Browserbase variables", () => {
    expect(
      buildAllowlistedEnv({
        STAGEHAND_BROWSER: "browserbase",
        BROWSERBASE_API_KEY: "bb-secret",
        CURSOR_API_KEY: "cursor-secret",
        HOST_SECRET: "host-secret",
        STAGEHAND_EMPTY: "",
      }),
    ).toEqual({
      STAGEHAND_BROWSER: "browserbase",
      BROWSERBASE_API_KEY: "bb-secret",
    });
  });

  it("configures one isolated MCP-only local agent", () => {
    const options = buildCursorAgentOptions("/tmp/workspace", "/tmp/facade-server.mjs", {
      CURSOR_API_KEY: "cursor-secret",
      STAGEHAND_BROWSER: "local",
      HOST_SECRET: "host-secret",
    });

    expect(options).toMatchObject({
      apiKey: "cursor-secret",
      model: { id: "composer-2.5" },
      tools: ["mcp"],
      local: { cwd: "/tmp/workspace", settingSources: [] },
      mcpServers: {
        stagehand: {
          type: "stdio",
          command: process.execPath,
          args: ["/tmp/facade-server.mjs"],
          env: { STAGEHAND_BROWSER: "local" },
        },
      },
    });
    expect(JSON.stringify(options.mcpServers)).not.toContain("cursor-secret");
    expect(JSON.stringify(options.mcpServers)).not.toContain("host-secret");
    expect(options.local?.store).toBeInstanceOf(JsonlLocalAgentStore);
  });

  it("uses an optional model override without requiring an explicit API key", () => {
    const options = buildCursorAgentOptions("/tmp/workspace", "/tmp/server.mjs", {
      CURSOR_STAGEHAND_MODEL: "custom-model",
    });
    expect(options.model).toEqual({ id: "custom-model" });
    expect(options).not.toHaveProperty("apiKey");
  });

  it("prefixes the task with canonical Stagehand instructions", () => {
    const prompt = buildCursorPrompt("browse example.com");
    expect(prompt).toBe(`${FACADE_AGENT_INSTRUCTIONS}\n\nTask:\nbrowse example.com`);
  });

  it("normalizes pnpm's optional argument separator", () => {
    expect(resolveInstruction(["--", "open", "example.com"])).toBe("open example.com");
    expect(resolveInstruction(["open", "example.com"])).toBe("open example.com");
  });

  it("returns final assistant text and cleans up the agent and workspace", async () => {
    const directory = await makeTemporaryDirectory();
    const fake = fakeAgent({ status: "finished", result: "  done  " });
    const createAgent = vi.fn(async () => fake.agent);

    await expect(
      runCursor("browse", {
        env: { STAGEHAND_BROWSER: "local", CURSOR_API_KEY: "cursor-secret" },
        facadeServerPath: "/tmp/facade-server.mjs",
        makeWorkspaceDirectory: async () => directory,
        createAgent,
      }),
    ).resolves.toBe("done");

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ["mcp"],
        local: expect.objectContaining({ cwd: directory, settingSources: [] }),
      }),
    );
    expect(fake.send).toHaveBeenCalledWith(buildCursorPrompt("browse"));
    expect(fake.dispose).toHaveBeenCalledOnce();
    await expect(access(directory)).rejects.toThrow();
  });

  it.each([
    [{ status: "finished" as const }, "Cursor returned no assistant text."],
    [
      { status: "error" as const, error: { message: "backend unavailable" } },
      "Cursor run failed: backend unavailable",
    ],
    [{ status: "cancelled" as const }, "Cursor run interrupted."],
  ])("reports terminal result failures and still cleans up", async (result, message) => {
    const directory = await makeTemporaryDirectory();
    const fake = fakeAgent(result);

    await expect(
      runCursor("browse", {
        facadeServerPath: "/tmp/facade-server.mjs",
        makeWorkspaceDirectory: async () => directory,
        createAgent: async () => fake.agent,
      }),
    ).rejects.toThrow(message);

    expect(fake.dispose).toHaveBeenCalledOnce();
    await expect(access(directory)).rejects.toThrow();
  });

  it("removes the workspace when agent creation fails", async () => {
    const directory = await makeTemporaryDirectory();
    await expect(
      runCursor("browse", {
        facadeServerPath: "/tmp/facade-server.mjs",
        makeWorkspaceDirectory: async () => directory,
        createAgent: async () => {
          throw new Error("creation failed");
        },
      }),
    ).rejects.toThrow("creation failed");
    await expect(access(directory)).rejects.toThrow();
  });

  it("disposes the agent and removes the workspace when send fails", async () => {
    const directory = await makeTemporaryDirectory();
    const dispose = vi.fn(async () => undefined);
    const agent: CursorRuntimeAgent = {
      send: vi.fn(async () => {
        throw new Error("send failed");
      }),
      [Symbol.asyncDispose]: dispose,
    };

    await expect(
      runCursor("browse", {
        facadeServerPath: "/tmp/facade-server.mjs",
        makeWorkspaceDirectory: async () => directory,
        createAgent: async () => agent,
      }),
    ).rejects.toThrow("send failed");
    expect(dispose).toHaveBeenCalledOnce();
    await expect(access(directory)).rejects.toThrow();
  });

  it("does not send a task when interrupted during agent creation", async () => {
    const directory = await makeTemporaryDirectory();
    const fake = fakeAgent({ status: "finished", result: "unexpected" });
    let finishCreation!: () => void;
    let notifyCreationStarted!: () => void;
    const creationStarted = new Promise<void>((resolve) => {
      notifyCreationStarted = resolve;
    });
    const createAgent = vi.fn(
      () =>
        new Promise<CursorRuntimeAgent>((resolve) => {
          finishCreation = () => resolve(fake.agent);
          notifyCreationStarted();
        }),
    );
    const running = runCursor("browse", {
      facadeServerPath: "/tmp/facade-server.mjs",
      makeWorkspaceDirectory: async () => directory,
      createAgent,
    });

    await creationStarted;
    process.emit("SIGINT");
    finishCreation();

    await expect(running).rejects.toThrow("Cursor run interrupted.");
    expect(fake.send).not.toHaveBeenCalled();
    expect(fake.dispose).toHaveBeenCalledOnce();
    await expect(access(directory)).rejects.toThrow();
  });

  it("cancels the new run when interrupted during send", async () => {
    const directory = await makeTemporaryDirectory();
    let finishSend!: () => void;
    let notifySendStarted!: () => void;
    const sendStarted = new Promise<void>((resolve) => {
      notifySendStarted = resolve;
    });
    const wait = vi.fn(() => new Promise<never>(() => undefined));
    const cancel = vi.fn(async () => undefined);
    const dispose = vi.fn(async () => undefined);
    const pendingRun: CursorRuntimeRun = { wait, cancel };
    const agent: CursorRuntimeAgent = {
      send: vi.fn(
        () =>
          new Promise<CursorRuntimeRun>((resolve) => {
            finishSend = () => resolve(pendingRun);
            notifySendStarted();
          }),
      ),
      [Symbol.asyncDispose]: dispose,
    };
    const running = runCursor("browse", {
      facadeServerPath: "/tmp/facade-server.mjs",
      makeWorkspaceDirectory: async () => directory,
      createAgent: async () => agent,
    });

    await sendStarted;
    process.emit("SIGINT");
    finishSend();

    await expect(running).rejects.toThrow("Cursor run interrupted.");
    expect(cancel).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    await expect(access(directory)).rejects.toThrow();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cancels the active run on %s and still cleans up",
    async (signal) => {
      const directory = await makeTemporaryDirectory();
      let resolveWait: ((value: { status: "cancelled" }) => void) | undefined;
      const wait = vi.fn(
        () =>
          new Promise<{ status: "cancelled" }>((resolve) => {
            resolveWait = resolve;
          }),
      );
      const cancel = vi.fn(async () => resolveWait?.({ status: "cancelled" }));
      const dispose = vi.fn(async () => undefined);
      const agent: CursorRuntimeAgent = {
        send: vi.fn(async () => ({ wait, cancel })),
        [Symbol.asyncDispose]: dispose,
      };
      const running = runCursor("browse", {
        facadeServerPath: "/tmp/facade-server.mjs",
        makeWorkspaceDirectory: async () => directory,
        createAgent: async () => agent,
      });

      await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
      process.emit(signal);
      await expect(running).rejects.toThrow("Cursor run interrupted.");
      await expect(running).rejects.toMatchObject({
        name: CursorInterruptionError.name,
        signal,
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(dispose).toHaveBeenCalledOnce();
      await expect(access(directory)).rejects.toThrow();
    },
  );

  it.skipIf(process.platform === "win32").each(["SIGINT", "SIGTERM"] as const)(
    "re-raises %s from the CLI failure handler",
    async (signal) => {
      const agentModule = new URL("../src/agent.ts", import.meta.url).href;
      const script = `import { CursorInterruptionError, handleFailure } from ${JSON.stringify(agentModule)}; handleFailure(new CursorInterruptionError(${JSON.stringify(signal)}));`;
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
        stdio: "ignore",
      });

      const [exitCode, exitSignal] = await once(child, "exit");
      expect(exitCode).toBeNull();
      expect(exitSignal).toBe(signal);
    },
  );

  it("reports an ordinary CLI failure to stderr with exit code 1", async () => {
    const agentModule = new URL("../src/agent.ts", import.meta.url).href;
    const script = `import { handleFailure } from ${JSON.stringify(agentModule)}; handleFailure(new Error("boom"));`;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr.setEncoding("utf8");
    let stderr = "";
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const [exitCode, exitSignal] = await once(child, "close");
    expect(exitCode).toBe(1);
    expect(exitSignal).toBeNull();
    expect(stderr).toBe("boom\n");
  });
});

function fakeAgent(result: {
  status: "finished" | "error" | "cancelled";
  result?: string;
  error?: { message: string };
}) {
  const wait = vi.fn(async () => result);
  const cancel = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ wait, cancel }));
  const dispose = vi.fn(async () => undefined);
  const agent: CursorRuntimeAgent = { send, [Symbol.asyncDispose]: dispose };
  return { agent, send, wait, cancel, dispose };
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stagehand-cursor-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
