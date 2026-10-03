import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvalsError } from "../../errors.js";
import {
  EVE_DISABLED_FRAMEWORK_TOOLS,
  EVE_TOOL_SURFACES,
  buildEveAgentAppFiles,
  buildEveAgentDefinitionSource,
  eveToolSlug,
  resolveEveModelProvider,
  writeEveAgentApp,
  writeEveAgentDefinition,
} from "../../framework/eveToolAdapter.js";
import { resolveToolSurface } from "../../framework/harnesses/toolSurfaceResolution.js";

describe("Eve tool adapter helpers", () => {
  it("sanitizes Eve tool slugs", () => {
    expect(eveToolSlug("stage-hand.v1", "run/tool-now")).toBe("stage_hand_v1__run_tool_now");
  });

  it("resolves supported model providers and defaults bare ids to OpenAI", () => {
    expect(resolveEveModelProvider("openai/gpt-5.4-mini")).toEqual({
      pkg: "@ai-sdk/openai",
      factory: "openai",
      modelId: "gpt-5.4-mini",
    });
    expect(resolveEveModelProvider("anthropic/claude-sonnet-4-6")).toEqual({
      pkg: "@ai-sdk/anthropic",
      factory: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    expect(resolveEveModelProvider("google/gemini-2.5-pro")).toEqual({
      pkg: "@ai-sdk/google",
      factory: "google",
      modelId: "gemini-2.5-pro",
    });
    expect(resolveEveModelProvider("gpt-5.4-mini").factory).toBe("openai");
    expect(() => resolveEveModelProvider("mistral/x")).toThrow(EvalsError);
    expect(() => resolveEveModelProvider("mistral/x")).toThrow(/openai\/, anthropic\/, google\//);
  });

  it("builds an agent definition with the selected model and uncapped token limits", () => {
    const source = buildEveAgentDefinitionSource("anthropic/claude-sonnet-4-6");
    expect(source).toContain('from "@ai-sdk/anthropic"');
    expect(source).toContain('anthropic("claude-sonnet-4-6")');
    expect(source).toContain("maxInputTokensPerSession: false");
    expect(source).toContain("maxOutputTokensPerSession: false");
  });

  it("builds authored MCP tools, bridge, instructions, and disabled built-ins", () => {
    const files = buildEveAgentAppFiles({
      instructions: "Use the mounted browser.",
      servers: {
        stagehand: [
          {
            name: "run",
            description: "Run browser code",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"],
            },
          },
        ],
      },
    });
    const tool = files["agent/tools/stagehand__run.ts"];
    expect(tool).toContain('"stagehand"');
    expect(tool).toContain('"run"');
    expect(tool).toContain('"code"');
    for (const name of EVE_DISABLED_FRAMEWORK_TOOLS) {
      expect(files[`agent/tools/${name}.ts`]).toContain("disableTool");
    }
    expect(files["agent/tools/load_skill.ts"]).toContain("disableTool");
    expect(files["agent/instructions.md"]).toContain("Use the mounted browser.");
    expect(files["agent/instructions.md"]).toContain("Never ask the user questions");
    expect(files["agent/instructions.md"]).toContain("requested compact JSON");
    expect(files["agent/lib/mcp-bridge.ts"]).toContain("STAGEHAND_EVE_MCP_SERVERS");
    expect(files["agent/lib/mcp-bridge.ts"]).toContain("@modelcontextprotocol/sdk/client/index.js");
    expect(files["agent/lib/mcp-bridge.ts"]).toContain("@modelcontextprotocol/sdk/client/stdio.js");
    expect(files).not.toHaveProperty("agent/agent.ts");
  });

  it("rejects generated slug collisions", () => {
    expect(() =>
      buildEveAgentAppFiles({
        instructions: "test",
        servers: {
          "server-one": [{ name: "tool.name", inputSchema: { type: "object" } }],
          server_one: [{ name: "tool/name", inputSchema: { type: "object" } }],
        },
      }),
    ).toThrow(/slug collision/);
  });

  it("writes an Eve app with a safe node_modules symlink and agent definition", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "eve-adapter-test-"));
    const nodeModulesDir = path.join(root, "modules");
    await fsp.mkdir(nodeModulesDir);
    await fsp.writeFile(path.join(nodeModulesDir, "marker"), "keep");
    const appRoot = await writeEveAgentApp({
      files: buildEveAgentAppFiles({ instructions: "test", servers: {} }),
      nodeModulesDir,
      tmpRoot: root,
      prefix: "app-",
    });
    try {
      expect(await fsp.readFile(path.join(appRoot, "package.json"), "utf8")).toContain(
        "stagehand-evals-eve-agent",
      );
      const stat = await fsp.lstat(path.join(appRoot, "node_modules"));
      expect(stat.isSymbolicLink()).toBe(true);
      expect(await fsp.readlink(path.join(appRoot, "node_modules"))).toBe(nodeModulesDir);
      await writeEveAgentDefinition(appRoot, "google/gemini-2.5-pro");
      expect(await fsp.readFile(path.join(appRoot, "agent", "agent.ts"), "utf8")).toContain(
        'google("gemini-2.5-pro")',
      );
      await fsp.rm(appRoot, { recursive: true, force: true });
      expect(await fsp.readFile(path.join(nodeModulesDir, "marker"), "utf8")).toBe("keep");
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("removes the temp app when generation fails after mkdtemp", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "eve-adapter-failure-test-"));
    const nodeModulesDir = path.join(root, "modules");
    const tmpRoot = path.join(root, "tmp");
    await fsp.mkdir(nodeModulesDir);
    await fsp.mkdir(tmpRoot);
    try {
      await expect(
        writeEveAgentApp({
          files: { node_modules: "not a dir" },
          nodeModulesDir,
          tmpRoot,
          prefix: "app-",
        }),
      ).rejects.toThrow();
      expect(await fsp.readdir(tmpRoot)).toEqual([]);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it("defaults to the facade and lists all supported surfaces in errors", () => {
    expect(EVE_TOOL_SURFACES[0]).toBe("stagehand_facade");
    expect(resolveToolSurface({ harness: "eve", supportedToolSurfaces: EVE_TOOL_SURFACES })).toBe(
      "stagehand_facade",
    );
    expect(() =>
      resolveToolSurface(
        { harness: "eve", supportedToolSurfaces: EVE_TOOL_SURFACES },
        "browse_cli",
      ),
    ).toThrow(/stagehand_facade, playwright_mcp, or chrome_devtools_mcp/);
  });
});
