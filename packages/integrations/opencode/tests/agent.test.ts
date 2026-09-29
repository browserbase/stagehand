import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FACADE_TOOLS } from "@browserbasehq/stagehand-integrations/facade";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import {
  normalizeOpenCodeUsage,
  type OpenCodeRuntime,
} from "@browserbasehq/stagehand-integrations-opencode-sdk";
import {
  buildOpenCodeConfig,
  resolveInstruction,
  runOpenCode,
  STAGEHAND_TOOL_NAMES,
} from "../src/agent.ts";

describe("OpenCode v2 Stagehand example", () => {
  it("forwards only non-empty browser variables", () => {
    expect(
      buildAllowlistedEnv({
        STAGEHAND_BROWSER: "local",
        ANTHROPIC_API_KEY: "secret",
        BROWSERBASE_API_KEY: "bb",
        STAGEHAND_EMPTY: "",
      }),
    ).toEqual({ STAGEHAND_BROWSER: "local", BROWSERBASE_API_KEY: "bb" });
  });

  it("configures a direct Stagehand MCP server and denies every other action", () => {
    const config = buildOpenCodeConfig("/tmp/facade-server.mjs", {
      STAGEHAND_BROWSER: "local",
      ANTHROPIC_API_KEY: "secret",
    });
    expect(config.mcp.servers.stagehand).toMatchObject({
      type: "local",
      codemode: false,
      command: [process.execPath, "/tmp/facade-server.mjs"],
      environment: { STAGEHAND_BROWSER: "local" },
    });
    expect(config.permissions).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      ...["run", "snapshot", "screenshot"].map((name) => ({
        action: `stagehand_${name}`,
        resource: "*",
        effect: "allow",
      })),
    ]);
    expect(config.update).toBe("disable");
    expect(JSON.stringify(config)).not.toContain("secret");
    expect([...STAGEHAND_TOOL_NAMES].sort()).toEqual(
      FACADE_TOOLS.map((tool) => `stagehand_${tool.name}`).sort(),
    );
  });

  it("uses a provider/model override only when supplied", () => {
    expect(
      buildOpenCodeConfig("/tmp/facade-server.mjs", { OPENCODE_MODEL: "openai/gpt-5" }).model,
    ).toBe("openai/gpt-5");
    expect(buildOpenCodeConfig("/tmp/facade-server.mjs", {}).model).toBeUndefined();
    expect(resolveInstruction(["--", "open", "example.com"])).toBe("open example.com");
  });

  it("runs and removes its temporary workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stagehand-opencode-test-"));
    const runtime: OpenCodeRuntime = {
      run: vi.fn(async () => ({
        messages: [],
        finalMessage: "done",
        status: "completed" as const,
        tokenUsage: normalizeOpenCodeUsage(undefined),
      })),
      close: vi.fn(async () => undefined),
    };
    try {
      await expect(
        runOpenCode("browse", {
          facadeServerPath: "/tmp/facade-server.mjs",
          makeRuntimeDirectory: async () => directory,
          startRuntime: async () => runtime,
        }),
      ).resolves.toBe("done");
      expect(runtime.run).toHaveBeenCalledWith({
        prompt: "browse",
        model: "opencode/auto",
        signal: expect.any(AbortSignal),
      });
      expect(runtime.close).toHaveBeenCalledOnce();
      await expect(access(directory)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
