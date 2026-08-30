import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunAcpFacadeAgentOptions } from "@browserbasehq/stagehand-integrations/acp";
import { FACADE_TOOLS } from "@browserbasehq/stagehand-integrations/facade";

import {
  createGrokProfile,
  createGrokRuntime,
  grokAcpArgs,
  resolveGrokAuthHome,
  resolveGrokExecutable,
  resolveInstruction,
  runGrokBuild,
  STAGEHAND_GROK_AGENT_PROFILE,
  STAGEHAND_GROK_TOOL_NAMES,
  type GrokRuntime,
} from "../src/agent.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Grok ACP profile", () => {
  it("derives its Grok MCP identities from the shared facade contract", () => {
    const expected = FACADE_TOOLS.map((tool) => `stagehand__${tool.name}`).sort();
    expect([...STAGEHAND_GROK_TOOL_NAMES].sort()).toStrictEqual(expected);
  });

  it("uses API-key auth before cached auth and keeps Grok's configured model", () => {
    const profile = createGrokProfile({
      executable: "/grok",
      cachedAuthAvailable: true,
      agentProfilePath: "/tmp/stagehand-browser.md",
    });
    const initialization = {
      protocolVersion: 1,
      authMethods: [
        { id: "xai.api_key", name: "API key" },
        { id: "cached_token", name: "Cached token" },
      ],
    };
    expect(profile.args).toStrictEqual(grokAcpArgs("/tmp/stagehand-browser.md"));
    expect(
      profile.resolveAuthentication?.({ initialization, env: { XAI_API_KEY: "xai-secret" } }),
    ).toStrictEqual({ methodId: "xai.api_key", _meta: { headless: true } });
    expect(profile.resolveAuthentication?.({ initialization, env: {} })).toStrictEqual({
      methodId: "cached_token",
      _meta: { headless: true },
    });
  });

  it("returns no auth method when credentials or advertised methods are missing", () => {
    const profile = createGrokProfile({
      executable: "/grok",
      cachedAuthAvailable: false,
      agentProfilePath: "/tmp/stagehand-browser.md",
    });
    expect(
      profile.resolveAuthentication?.({
        initialization: {
          protocolVersion: 1,
          authMethods: [{ id: "cached_token", name: "Cached token" }],
        },
        env: {},
      }),
    ).toBeUndefined();
  });

  it("sets Grok rules metadata and classifies exact legacy and current Grok MCP identities", () => {
    const profile = createGrokProfile({
      executable: "/grok",
      cachedAuthAvailable: false,
      agentProfilePath: "/tmp/stagehand-browser.md",
    });
    expect(profile.buildSessionMeta?.("rules")).toStrictEqual({ rules: "rules" });
    expect(
      profile.isFacadeToolCall({
        toolCallId: "one",
        title: "stagehand__run",
        _meta: { "x.ai/tool": { namespace: "mcp" } },
      }),
    ).toBe(true);
    expect(
      profile.isFacadeToolCall({
        toolCallId: "two",
        title: "stagehand__snapshot",
        rawInput: { tool_name: "stagehand__snapshot" },
        _meta: { "x.ai/tool": { namespace: "grok_build", name: "use_tool" } },
      }),
    ).toBe(true);
    expect(
      profile.isFacadeToolCall({
        toolCallId: "three",
        title: "bash",
        _meta: { "x.ai/tool": { namespace: "grok_build", name: "use_tool" } },
      }),
    ).toBe(false);
    expect(
      profile.isFacadeToolCall({
        toolCallId: "four",
        title: "stagehand__run",
        _meta: { "x.ai/tool": { namespace: "grok_build", name: "bash" } },
      }),
    ).toBe(false);
  });

  it("resolves the packaged Grok executable", async () => {
    const executable = resolveGrokExecutable();
    await expect(access(executable)).resolves.toBeUndefined();
    expect(executable.replaceAll("\\", "/")).toContain("@xai-official/grok/bin/grok");
  });

  it("resolves cached auth only from the supplied environment", () => {
    expect(resolveGrokAuthHome({ GROK_HOME: "/configured", HOME: "/home" })).toBe("/configured");
    expect(resolveGrokAuthHome({ HOME: "/home" })).toBe(join("/home", ".grok"));
    expect(resolveGrokAuthHome({ USERPROFILE: "C:\\Users\\test" })).toBe(
      join("C:\\Users\\test", ".grok"),
    );
    expect(
      resolveGrokAuthHome({ HOME: "/git-bash/home", USERPROFILE: "C:\\Users\\test" }, "win32"),
    ).toBe(join("C:\\Users\\test", ".grok"));
    expect(resolveGrokAuthHome({})).toBeUndefined();
  });
});

describe("Grok isolated runtime", () => {
  it("copies only cached auth and writes an MCP-compatible isolated config", async () => {
    const sourceHome = await makeTemp("grok-source-");
    await mkdir(sourceHome, { recursive: true });
    await writeFile(join(sourceHome, "auth.json"), '{"token":"cached"}\n');
    await writeFile(join(sourceHome, "config.toml"), "[mcp_servers.other]\ncommand='other'\n");

    const runtime = await createGrokRuntime({ GROK_HOME: sourceHome });
    temporaryDirectories.push(runtime.root);
    expect(runtime.cachedAuthAvailable).toBe(true);
    await expect(readFile(join(runtime.grokHome, "auth.json"), "utf8")).resolves.toContain(
      "cached",
    );
    expect(runtime.agentProfilePath).toBe(join(runtime.grokHome, STAGEHAND_GROK_AGENT_PROFILE));
    await expect(readFile(runtime.agentProfilePath, "utf8")).resolves.toContain(
      "description: Browser-only Stagehand MCP agent",
    );
    await expect(readFile(runtime.agentProfilePath, "utf8")).resolves.toContain("search_tool");
    await expect(readFile(runtime.agentProfilePath, "utf8")).resolves.toContain("use_tool");
    await expect(readFile(runtime.agentProfilePath, "utf8")).resolves.not.toContain("bash");
    const config = await readFile(join(runtime.grokHome, "config.toml"), "utf8");
    expect(config).toContain("auto_update = false");
    expect(config).toContain("[compat.claude]");
    expect(config).toContain("[compat.cursor]");
    expect(config).toContain("[subagents]");
    expect(config).toContain("enabled = false");
    expect(config).not.toContain("mcp_servers.other");
  });

  it("does not copy cached auth when an API key is supplied", async () => {
    const sourceHome = await makeTemp("grok-source-");
    await writeFile(join(sourceHome, "auth.json"), '{"token":"cached"}\n');
    const runtime = await createGrokRuntime({
      GROK_HOME: sourceHome,
      XAI_API_KEY: "xai-secret",
    });
    temporaryDirectories.push(runtime.root);
    expect(runtime.cachedAuthAvailable).toBe(false);
    await expect(access(join(runtime.grokHome, "auth.json"))).rejects.toThrow();
  });

  it("passes the isolated home to ACP and removes all runtime state", async () => {
    const root = await makeTemp("grok-run-");
    const runtime: GrokRuntime = {
      root,
      userHome: join(root, "home"),
      cwd: join(root, "workspace"),
      grokHome: join(root, "grok-home"),
      agentProfilePath: join(root, "grok-home", STAGEHAND_GROK_AGENT_PROFILE),
      cachedAuthAvailable: true,
    };
    await Promise.all([
      mkdir(runtime.cwd, { recursive: true }),
      mkdir(runtime.userHome, { recursive: true }),
      mkdir(runtime.grokHome, { recursive: true }),
    ]);
    const runAcp = vi.fn(async (_options: RunAcpFacadeAgentOptions) => "done");

    await expect(
      runGrokBuild("Open example.com", {
        env: { XAI_API_KEY: "xai-secret" },
        grokExecutable: "/grok",
        makeRuntime: async () => runtime,
        runAcp,
      }),
    ).resolves.toBe("done");
    expect(runAcp).toHaveBeenCalledOnce();
    expect(runAcp.mock.calls[0]?.[0]).toMatchObject({
      instruction: "Open example.com",
      cwd: runtime.cwd,
      env: {
        HOME: runtime.userHome,
        USERPROFILE: runtime.userHome,
        GROK_HOME: runtime.grokHome,
        XAI_API_KEY: "xai-secret",
      },
      profile: {
        command: "/grok",
        args: grokAcpArgs(runtime.agentProfilePath),
      },
    });
    await expect(access(root)).rejects.toThrow();
  });

  it("normalizes CLI instructions", () => {
    expect(resolveInstruction(["--", "open", "example.com"])).toBe("open example.com");
  });
});

async function makeTemp(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}
