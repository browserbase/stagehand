import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FACADE_AGENT_INSTRUCTIONS,
  FACADE_TOOLS,
} from "@browserbasehq/stagehand-integrations/facade";

import {
  buildAllowlistedEnv,
  buildOpenCodeConfig,
  extractAssistantText,
  resolveInstruction,
  runOpenCode,
  STAGEHAND_TOOL_NAMES,
  withTemporaryEnvironment,
  type OpenCodeRuntime,
} from "../src/agent.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("opencode stagehand example", () => {
  it("forwards only non-empty Stagehand and Browserbase variables", () => {
    expect(
      buildAllowlistedEnv({
        STAGEHAND_BROWSER: "browserbase",
        BROWSERBASE_API_KEY: "bb-secret",
        ANTHROPIC_API_KEY: "agent-secret",
        HOST_SECRET: "host-secret",
        STAGEHAND_EMPTY: "",
      }),
    ).toEqual({
      STAGEHAND_BROWSER: "browserbase",
      BROWSERBASE_API_KEY: "bb-secret",
    });
  });

  it("configures exactly one local Stagehand MCP server", () => {
    const config = buildOpenCodeConfig("/tmp/facade-server.mjs", {
      STAGEHAND_BROWSER: "local",
      ANTHROPIC_API_KEY: "agent-secret",
    });
    expect(config.mcp).toEqual({
      stagehand: {
        type: "local",
        enabled: true,
        command: [process.execPath, "/tmp/facade-server.mjs"],
        environment: { STAGEHAND_BROWSER: "local" },
      },
    });
    expect(JSON.stringify(config)).not.toContain("agent-secret");
  });

  it("allows exactly the OpenCode-prefixed facade tools", () => {
    const expected = FACADE_TOOLS.map((tool) => `stagehand_${tool.name}`).sort();
    expect([...STAGEHAND_TOOL_NAMES].sort()).toEqual(expected);
  });

  it("disables every tool except the three Stagehand tools", () => {
    const config = buildOpenCodeConfig("/tmp/facade-server.mjs", {});
    expect(config.tools).toEqual({
      "*": false,
      stagehand_run: true,
      stagehand_snapshot: true,
      stagehand_screenshot: true,
    });
    expect(config.permission).toEqual({
      "*": "deny",
      stagehand_run: "allow",
      stagehand_snapshot: "allow",
      stagehand_screenshot: "allow",
    });
  });

  it("uses the optional OpenCode model without adding a Stagehand model override", () => {
    expect(
      buildOpenCodeConfig("/tmp/facade-server.mjs", { OPENCODE_MODEL: "openai/gpt-5" }).model,
    ).toBe("openai/gpt-5");
    expect(buildOpenCodeConfig("/tmp/facade-server.mjs", {}).model).toBeUndefined();
  });

  it("assembles text parts in response order and ignores other content", () => {
    expect(
      extractAssistantText({
        data: {
          parts: [
            { type: "reasoning", text: "hidden" },
            { type: "text", text: "Hello" },
            { type: "tool", text: "ignored" },
            { type: "text", text: " world" },
          ],
        },
      }),
    ).toBe("Hello world");
  });

  it("normalizes pnpm's optional argument separator", () => {
    expect(resolveInstruction(["--", "open", "example.com"])).toBe("open example.com");
    expect(resolveInstruction(["open", "example.com"])).toBe("open example.com");
  });

  it("restores temporary process environment overrides", async () => {
    const original = process.env.OPENCODE_CONFIG;
    process.env.OPENCODE_CONFIG = "before";
    await expect(
      withTemporaryEnvironment({ OPENCODE_CONFIG: "during", OPENCODE_CONFIG_DIR: "/tmp/x" }, () => {
        expect(process.env.OPENCODE_CONFIG).toBe("during");
        expect(process.env.OPENCODE_CONFIG_DIR).toBe("/tmp/x");
        return Promise.resolve("done");
      }),
    ).resolves.toBe("done");
    expect(process.env.OPENCODE_CONFIG).toBe("before");
    expect(process.env.OPENCODE_CONFIG_DIR).toBeUndefined();
    if (original === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = original;
  });

  it("runs one session with canonical instructions and cleans up", async () => {
    const directory = await makeTemporaryDirectory();
    const { runtime, create, prompt, deleteSession, close } = fakeRuntime();
    const startRuntime = vi.fn(async () => runtime);

    await expect(
      runOpenCode("browse", {
        env: { STAGEHAND_BROWSER: "local", ANTHROPIC_API_KEY: "agent-secret" },
        facadeServerPath: "/tmp/facade-server.mjs",
        makeRuntimeDirectory: async () => directory,
        startRuntime,
      }),
    ).resolves.toBe("done");

    expect(startRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: join(directory, "workspace"),
        configRoot: join(directory, "config"),
      }),
    );
    expect(create).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "session-1",
        system: FACADE_AGENT_INSTRUCTIONS,
        tools: {
          stagehand_run: true,
          stagehand_snapshot: true,
          stagehand_screenshot: true,
        },
        parts: [{ type: "text", text: "browse" }],
      }),
      expect.objectContaining({ throwOnError: true }),
    );
    expect(deleteSession).toHaveBeenCalledWith(
      { sessionID: "session-1" },
      expect.objectContaining({ throwOnError: false }),
    );
    expect(close).toHaveBeenCalledOnce();
    await expect(access(directory)).rejects.toThrow();
  });

  it.each(["session creation", "prompt"])(
    "closes the server and removes runtime files after %s failure",
    async (failure) => {
      const directory = await makeTemporaryDirectory();
      const fakes = fakeRuntime(failure);
      await expect(
        runOpenCode("browse", {
          facadeServerPath: "/tmp/facade-server.mjs",
          makeRuntimeDirectory: async () => directory,
          startRuntime: async () => fakes.runtime,
        }),
      ).rejects.toThrow(failure);
      expect(fakes.close).toHaveBeenCalledOnce();
      await expect(access(directory)).rejects.toThrow();
    },
  );

  it("aborts the active SDK request on interruption and still cleans up", async () => {
    const directory = await makeTemporaryDirectory();
    const fakes = fakeRuntime();
    fakes.prompt.mockImplementation(
      (_parameters: unknown, options?: unknown) =>
        new Promise((_resolve, reject) => {
          const signal = (options as { signal: AbortSignal }).signal;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const run = runOpenCode("browse", {
      facadeServerPath: "/tmp/facade-server.mjs",
      makeRuntimeDirectory: async () => directory,
      startRuntime: async () => fakes.runtime,
    });

    await vi.waitFor(() => expect(fakes.prompt).toHaveBeenCalledOnce());
    process.emit("SIGINT");
    await expect(run).rejects.toThrow("interrupted");
    expect(fakes.close).toHaveBeenCalledOnce();
    await expect(access(directory)).rejects.toThrow();
  });
});

function fakeRuntime(failure?: string) {
  const create = vi.fn(async () =>
    failure === "session creation" ? { error: "session creation" } : { data: { id: "session-1" } },
  );
  const prompt = vi.fn(
    async (
      _parameters?: unknown,
      _options?: unknown,
    ): Promise<{ data?: unknown; error?: unknown }> =>
      failure === "prompt"
        ? { error: "prompt" }
        : { data: { parts: [{ type: "text", text: "done" }] } },
  );
  const deleteSession = vi.fn(async () => ({ data: true }));
  const close = vi.fn();
  const runtime: OpenCodeRuntime = {
    client: { session: { create, prompt, delete: deleteSession } },
    close,
  };
  return { runtime, create, prompt, deleteSession, close };
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stagehand-opencode-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
