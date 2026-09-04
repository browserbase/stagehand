import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "smol-toml";
import {
  buildGrokBuildMcpConfig,
  copyGrokBuildAuth,
  GROK_BUILD_TOOL_SURFACES,
  isGrokBuildMountToolName,
  resolveGrokBuildAuthHome,
  writeGrokBuildWorkspace,
} from "../../framework/grokBuildToolAdapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

describe("Grok Build tool adapter helpers", () => {
  it("supports MCP mounts and converts their config to Grok TOML shape", () => {
    expect(GROK_BUILD_TOOL_SURFACES).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
    expect(
      buildGrokBuildMcpConfig({
        stagehand: { command: "node", args: ["server.mjs"], env: { TOKEN: "value" } },
      }),
    ).toEqual({
      mcp_servers: {
        stagehand: {
          command: "node",
          args: ["server.mjs"],
          env: { TOKEN: "value" },
          startup_timeout_sec: 60,
          tool_timeout_sec: 300,
        },
      },
    });
  });

  it("writes the MCP config to the isolated user scope", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "grok-build-workspace-test-"));
    tempDirs.push(root);
    const cwd = path.join(root, "workspace");
    const grokHome = path.join(root, "home", ".grok");
    const result = await writeGrokBuildWorkspace(cwd, grokHome, {
      stagehand: { command: "node", args: ["server.mjs"] },
    });
    const userConfig = parse(await fsp.readFile(path.join(grokHome, "config.toml"), "utf8"));
    expect(result.mcpConfigPath).toBe(path.join(grokHome, "config.toml"));
    expect(userConfig).toMatchObject({
      mcp_servers: { stagehand: { command: "node", args: ["server.mjs"] } },
      cli: { auto_update: false, use_leader: false },
      subagents: { enabled: false },
      memory: { enabled: false },
    });
  });

  it("copies cached auth only when no API key is supplied", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "grok-build-auth-test-"));
    tempDirs.push(root);
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await Promise.all([fsp.mkdir(source), fsp.mkdir(target)]);
    await fsp.writeFile(path.join(source, "auth.json"), '{"token":"cached"}\n');
    expect(resolveGrokBuildAuthHome({ GROK_HOME: source })).toBe(source);
    await expect(copyGrokBuildAuth({ GROK_HOME: source }, target)).resolves.toBe(true);
    await expect(fsp.readFile(path.join(target, "auth.json"), "utf8")).resolves.toContain("cached");
    await fsp.rm(path.join(target, "auth.json"));
    await expect(
      copyGrokBuildAuth({ GROK_HOME: source, XAI_API_KEY: "secret" }, target),
    ).resolves.toBe(false);
  });

  it("matches Grok MCP tool identities", () => {
    const matches = (name: string) => isGrokBuildMountToolName(["stagehand"], name);
    for (const name of ["stagehand.run", "stagehand__run", "mcp__stagehand__run"]) {
      expect(matches(name)).toBe(true);
    }
    expect(matches("shell")).toBe(false);
  });
});
