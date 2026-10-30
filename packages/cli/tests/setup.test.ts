import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveConnectionTarget } from "../src/lib/driver/mode.js";
import {
  loadSetupEnvironment,
  readSetupConfig,
  writeSetupConfig,
} from "../src/lib/setup/config.js";
import { nodeExecutable } from "../src/lib/setup/install.js";
import {
  updateJsonMcp,
  updateOpenCodeMcp,
  updateTomlMcp,
} from "../src/lib/setup/mcp.js";
import { fakeNpm } from "./helpers/fake-npm.js";
import { itPosix } from "./helpers/platform.js";
import { runCli } from "./helpers/run-cli.js";

const temporaryDirs: string[] = [];
const runtimeDir = (dir: string) =>
  join(dir, ".local/share/browserbase/stagehand-mcp");

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "browse-setup-"));
  temporaryDirs.push(dir);
  return {
    dir,
    env: {
      HOME: dir,
      USERPROFILE: dir,
      BROWSERBASE_CONFIG_DIR: join(dir, "browserbase"),
      CLAUDE_CONFIG_DIR: join(dir, ".claude"),
      CODEX_HOME: join(dir, ".codex"),
      XDG_CONFIG_HOME: join(dir, ".config"),
      XDG_DATA_HOME: join(dir, ".local/share"),
      OPENCODE_CONFIG_DIR: undefined,
      BROWSERBASE_API_KEY: undefined,
      BROWSE_BROWSER: undefined,
      BROWSE_LOAD_DOTENV: "0",
      ...(await fakeNpm(dir)),
    },
  };
}

async function writeSetupConfigIn(
  env: { BROWSERBASE_CONFIG_DIR: string },
  config: object,
) {
  await mkdir(env.BROWSERBASE_CONFIG_DIR, { recursive: true });
  await writeFile(
    join(env.BROWSERBASE_CONFIG_DIR, "browse.json"),
    JSON.stringify(config),
  );
}

async function readSetupConfigIn(env: { BROWSERBASE_CONFIG_DIR: string }) {
  return JSON.parse(
    await readFile(join(env.BROWSERBASE_CONFIG_DIR, "browse.json"), "utf8"),
  );
}

// Tests that install the MCP runtime use a POSIX npm stub.
describe("browse setup", () => {
  itPosix(
    "installs both integrations, and updates MCP when rerun without losing client settings",
    async () => {
      const { dir, env } = await fixture();
      await mkdir(join(dir, ".codex"));
      await writeFile(
        join(dir, ".codex/config.toml"),
        '# Keep this comment\nmodel = "existing-model"\n[mcp_servers.other]\ncommand = "other"\n',
      );
      await mkdir(join(dir, ".config/opencode"), { recursive: true });
      await writeFile(
        join(dir, ".config/opencode/opencode.jsonc"),
        '{\n // keep opencode settings\n "model": "existing/model", "mcp": { "servers": { "other": { "type": "remote", "url": "https://example.com/mcp" } } }\n}\n',
      );
      const args = [
        "setup",
        "--mode",
        "both",
        "--browser",
        "local",
        "--agent",
        "claude",
        "--agent",
        "codex",
        "--agent",
        "cursor",
        "--agent",
        "opencode",
        "--yes",
      ];
      for (const version of ["0.1.1", "0.1.2"]) {
        const result = await runCli(args, {
          cwd: dir,
          env: { ...env, FAKE_MIDDLEWARE_VERSION: version },
        });
        expect(result, result.stderr).toMatchObject({ exitCode: 0 });
        expect(result.stdout).toContain(
          `Installed stagehand-middleware@${version}`,
        );
      }
      const { version: id } = JSON.parse(
        await readFile(join(runtimeDir(dir), "current.json"), "utf8"),
      );
      expect(id).toMatch(/^0\.1\.2-/);
      const entry = [join(runtimeDir(dir), "main.mjs"), "--local"];
      const codexRaw = await readFile(join(dir, ".codex/config.toml"), "utf8");
      expect(codexRaw).toContain("# Keep this comment");
      expect(parseToml(codexRaw)).toMatchObject({
        model: "existing-model",
        mcp_servers: {
          other: { command: "other" },
          stagehand: { command: process.execPath, args: entry },
        },
      });
      const claude = JSON.parse(
        await readFile(join(dir, ".claude/.claude.json"), "utf8"),
      );
      expect(claude.mcpServers.stagehand).toMatchObject({
        type: "stdio",
        args: entry,
      });
      const cursor = JSON.parse(
        await readFile(join(dir, ".cursor/mcp.json"), "utf8"),
      );
      expect(cursor.mcpServers.stagehand.command).toBe(process.execPath);
      const openCodeRaw = await readFile(
        join(dir, ".config/opencode/opencode.jsonc"),
        "utf8",
      );
      expect(openCodeRaw).toContain("// keep opencode settings");
      expect(parseJsonc(openCodeRaw)).toMatchObject({
        model: "existing/model",
        mcp: {
          servers: {
            other: { type: "remote", url: "https://example.com/mcp" },
            stagehand: {
              type: "local",
              command: [process.execPath, ...entry],
              timeout: { startup: 60_000, execution: 180_000 },
            },
          },
        },
      });
      expect(parseJsonc(openCodeRaw).mcp.servers.stagehand).not.toHaveProperty(
        "enabled",
      );
      for (const path of [
        ".claude/skills/browse/SKILL.md",
        ".agents/skills/browse/SKILL.md",
        ".cursor/skills/browse/SKILL.md",
        ".config/opencode/skills/browse/SKILL.md",
      ]) {
        expect(await readFile(join(dir, path), "utf8")).toContain(
          "name: browse",
        );
      }
      expect(
        JSON.parse(
          await readFile(join(dir, "browserbase/browse.json"), "utf8"),
        ),
      ).toEqual({ browser: "local" });
    },
  );

  itPosix(
    "allows cloud setup without auth and keeps credentials out of project configs",
    async () => {
      const { dir, env } = await fixture();
      await writeSetupConfigIn(env, { browser: "local" });
      const result = await runCli(
        [
          "setup",
          "--mode",
          "mcp",
          "--browser",
          "cloud",
          "--agent",
          "claude",
          "--project",
          "--yes",
        ],
        { cwd: dir, env },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      // Project setup must not change the default browser of other projects.
      expect(await readSetupConfigIn(env)).toEqual({ browser: "local" });
      expect(result.stdout).toContain(
        "Cloud browsers need BROWSERBASE_API_KEY",
      );
      const raw = await readFile(join(dir, ".mcp.json"), "utf8");
      expect(JSON.parse(raw).mcpServers.stagehand.args.at(-1)).toBe("--remote");
      expect(raw).not.toContain("apiKey");
      await expect(
        stat(join(dir, ".claude/skills/browse/SKILL.md")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("rejects malformed client config before installing any files", async () => {
    const { dir, env } = await fixture();
    await writeFile(join(dir, ".mcp.json"), '{"mcpServers": [');
    const result = await runCli(
      [
        "setup",
        "--mode",
        "both",
        "--browser",
        "local",
        "--agent",
        "claude",
        "--project",
        "--yes",
      ],
      { cwd: dir, env },
    );
    expect(result.exitCode).toBe(1);
    expect(await readFile(join(dir, ".mcp.json"), "utf8")).toBe(
      '{"mcpServers": [',
    );
    for (const path of [
      join(dir, ".claude/skills/browse/SKILL.md"),
      runtimeDir(dir),
    ])
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails usefully without a terminal or explicit choices", async () => {
    const { dir, env } = await fixture();
    const result = await runCli(["setup"], { cwd: dir, env });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Non-interactive setup needs");
  });

  itPosix.each([
    ["opencode.json", "opencode.json"],
    ["opencode.jsonc", "opencode.jsonc"],
    [".opencode/opencode.json", ".opencode/opencode.json"],
    [".opencode/opencode.jsonc", ".opencode/opencode.jsonc"],
  ])(
    "updates an existing OpenCode v2 project config at %s",
    async (existing, expected) => {
      const { dir, env } = await fixture();
      await mkdir(dirname(join(dir, existing)), { recursive: true });
      await writeFile(join(dir, existing), '{"model":"keep/model"}\n');
      const result = await runCli(
        [
          "setup",
          "--mode",
          "both",
          "--browser",
          "local",
          "--agent",
          "opencode",
          "--project",
          "--yes",
        ],
        { cwd: dir, env },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(
        parseJsonc(await readFile(join(dir, expected), "utf8")),
      ).toMatchObject({
        model: "keep/model",
        mcp: { servers: { stagehand: { type: "local" } } },
      });
      expect(
        await readFile(join(dir, ".opencode/skills/browse/SKILL.md"), "utf8"),
      ).toContain("name: browse");
      if (existing !== "opencode.jsonc")
        await expect(stat(join(dir, "opencode.jsonc"))).rejects.toMatchObject({
          code: "ENOENT",
        });
    },
  );

  itPosix(
    "uses OpenCode's JSONC and nested-directory precedence without editing lower-priority files",
    async () => {
      const { dir, env } = await fixture();
      await mkdir(join(dir, ".opencode"));
      const files = [
        "opencode.json",
        "opencode.jsonc",
        ".opencode/opencode.json",
        ".opencode/opencode.jsonc",
      ];
      for (const file of files) await writeFile(join(dir, file), "{}\n");
      const result = await runCli(
        [
          "setup",
          "--mode",
          "mcp",
          "--browser",
          "cloud",
          "--agent",
          "opencode",
          "--project",
          "--yes",
        ],
        { cwd: dir, env },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      for (const file of files.slice(0, -1))
        expect(await readFile(join(dir, file), "utf8")).toBe("{}\n");
      const config = parseJsonc(
        await readFile(join(dir, files.at(-1)!), "utf8"),
      );
      expect(config.mcp.servers.stagehand.command.at(-1)).toBe("--remote");
    },
  );

  it("detects OpenCode in a custom global config directory and installs only its skill in CLI mode", async () => {
    const { dir, env } = await fixture();
    const custom = join(dir, "custom-opencode");
    await mkdir(custom);
    const result = await runCli(
      ["setup", "--mode", "cli", "--browser", "local", "--yes"],
      { cwd: dir, env: { ...env, OPENCODE_CONFIG_DIR: custom } },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("OpenCode v2");
    expect(
      await readFile(join(custom, "skills/browse/SKILL.md"), "utf8"),
    ).toContain("name: browse");
    await expect(stat(join(custom, "opencode.jsonc"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  itPosix(
    "updates an existing global OpenCode JSON file without creating a second config",
    async () => {
      const { dir, env } = await fixture();
      const configDir = join(env.XDG_CONFIG_HOME, "opencode");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "opencode.json"),
        '{"model":"keep/model"}',
      );
      const result = await runCli(
        [
          "setup",
          "--mode",
          "mcp",
          "--browser",
          "local",
          "--agent",
          "opencode",
          "--yes",
        ],
        { cwd: dir, env },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(
        JSON.parse(await readFile(join(configDir, "opencode.json"), "utf8")),
      ).toMatchObject({
        model: "keep/model",
        mcp: { servers: { stagehand: { type: "local" } } },
      });
      await expect(
        stat(join(configDir, "opencode.jsonc")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  itPosix("creates an OpenCode JSONC config for a new project", async () => {
    const { dir, env } = await fixture();
    const result = await runCli(
      [
        "setup",
        "--mode",
        "mcp",
        "--browser",
        "local",
        "--agent",
        "opencode",
        "--project",
        "--yes",
      ],
      { cwd: dir, env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(
      parseJsonc(await readFile(join(dir, "opencode.jsonc"), "utf8")).mcp
        .servers.stagehand.type,
    ).toBe("local");
  });

  it("rejects invalid OpenCode config before installing files for any selected agent", async () => {
    const { dir, env } = await fixture();
    await writeFile(join(dir, "opencode.jsonc"), '{"mcp":{"servers":[]}}');
    const result = await runCli(
      [
        "setup",
        "--mode",
        "both",
        "--browser",
        "local",
        "--agent",
        "claude",
        "--agent",
        "opencode",
        "--project",
        "--yes",
      ],
      { cwd: dir, env },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("mcp.servers must be an object");
    await expect(stat(join(dir, ".mcp.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      stat(join(dir, ".claude/skills/browse/SKILL.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("setup config", () => {
  it("stores a private key, loads it for later commands, and honors environment overrides", async () => {
    const { env } = await fixture();
    vi.stubEnv("BROWSERBASE_CONFIG_DIR", env.BROWSERBASE_CONFIG_DIR);
    vi.stubEnv("BROWSERBASE_API_KEY", undefined);
    vi.stubEnv("BROWSE_BROWSER", undefined);
    await writeSetupConfig({ browser: "cloud", apiKey: "saved-test-key" });
    expect(await readSetupConfig()).toEqual({
      browser: "cloud",
      apiKey: "saved-test-key",
    });
    if (process.platform !== "win32") {
      expect(
        (await stat(join(env.BROWSERBASE_CONFIG_DIR, "browse.json"))).mode &
          0o777,
      ).toBe(0o600);
    }
    await loadSetupEnvironment();
    expect(process.env.BROWSERBASE_API_KEY).toBe("saved-test-key");
    expect(process.env.BROWSE_BROWSER).toBe("cloud");
    vi.stubEnv("BROWSERBASE_API_KEY", "environment-test-key");
    vi.stubEnv("BROWSE_BROWSER", "local");
    await loadSetupEnvironment();
    expect(process.env.BROWSERBASE_API_KEY).toBe("environment-test-key");
    expect(process.env.BROWSE_BROWSER).toBe("local");
  });

  it("does not switch to cloud for a saved key without a saved cloud preference", async () => {
    const { env } = await fixture();
    vi.stubEnv("BROWSERBASE_CONFIG_DIR", env.BROWSERBASE_CONFIG_DIR);
    vi.stubEnv("BROWSERBASE_API_KEY", undefined);
    vi.stubEnv("BROWSE_BROWSER", undefined);
    await writeSetupConfig({ apiKey: "saved-test-key" });
    await loadSetupEnvironment();
    expect(process.env.BROWSERBASE_API_KEY).toBe("saved-test-key");
    expect(await resolveConnectionTarget({})).toMatchObject({
      kind: "managed-local",
    });
    // A key from the environment keeps its existing auto-remote default.
    vi.stubEnv("BROWSERBASE_API_KEY", "environment-test-key");
    vi.stubEnv("BROWSE_BROWSER", undefined);
    await loadSetupEnvironment();
    expect(await resolveConnectionTarget({})).toMatchObject({ kind: "remote" });
  });
  it("uses the saved browser as the default target, with flags taking precedence", async () => {
    vi.stubEnv("BROWSERBASE_API_KEY", "environment-test-key");
    vi.stubEnv("BROWSE_BROWSER", "local");
    expect(await resolveConnectionTarget({})).toMatchObject({
      kind: "managed-local",
    });
    expect(await resolveConnectionTarget({ remote: true })).toMatchObject({
      kind: "remote",
    });
    vi.stubEnv("BROWSE_BROWSER", "cloud");
    expect(await resolveConnectionTarget({})).toMatchObject({ kind: "remote" });
    expect(await resolveConnectionTarget({ local: true })).toMatchObject({
      kind: "managed-local",
    });
    await expect(resolveConnectionTarget({ headed: true })).rejects.toThrow(
      "pass --local to override it",
    );
  });
});

describe("MCP Node selection", () => {
  async function fakeNode(dir: string, version: string) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "node"), `#!/bin/sh\necho ${version}\n`);
    await chmod(join(dir, "node"), 0o755);
    return dir;
  }

  it("uses the running Node when it is supported, and rejects an old one", async () => {
    const setup = { bun: false, execPath: "/usr/bin/node", PATH: "" };
    expect(await nodeExecutable({ ...setup, version: "v22.18.0" })).toEqual({
      path: "/usr/bin/node",
      version: "v22.18.0",
    });
    await expect(
      nodeExecutable({ ...setup, version: "v20.19.0" }),
    ).rejects.toThrow("found v20.19.0");
  });

  itPosix("under Bun, skips unsupported Node versions on PATH", async () => {
    const { dir } = await fixture();
    const old = await fakeNode(join(dir, "old"), "v20.19.0");
    const supported = await fakeNode(join(dir, "new"), "v24.1.0");
    const setup = { bun: true, execPath: "/bun", version: "v24.3.0" };
    expect(
      await nodeExecutable({
        ...setup,
        PATH: [old, supported].join(delimiter),
      }),
    ).toEqual({ path: join(supported, "node"), version: "v24.1.0" });
    await expect(nodeExecutable({ ...setup, PATH: old })).rejects.toThrow(
      `found v20.19.0 at ${join(old, "node")}`,
    );
  });
});

describe("MCP config edits", () => {
  const entry = {
    command: "node",
    args: ["/path with spaces/main.js", "--local"],
  };
  it("preserves JSON comments and unrelated servers", () => {
    const raw =
      '{\n // keep\n "mcpServers": { "other": { "url": "https://example.com" } },\n "theme": "dark",\n}\n';
    const updated = updateJsonMcp(raw, entry, false);
    expect(updated).toContain("// keep");
    expect(updated).toContain('"theme": "dark"');
    expect(parseJsonc(updated).mcpServers.other).toEqual({
      url: "https://example.com",
    });
  });
  it("writes OpenCode v2 server settings without replacing global MCP timeouts or other servers", () => {
    const raw =
      '{\n // keep\n "mcp": { "timeout": {"startup": 30000}, "servers": {"other": {"type":"remote", "url":"https://example.com"}, "stagehand": {"type":"remote", "url":"https://old.example.com", "disabled":true, "environment":{"STAGEHAND_BROWSERBASE_VERIFIED":"true"}}}}\n}';
    const updated = updateOpenCodeMcp(raw, entry);
    expect(updated).toContain("// keep");
    expect(parseJsonc(updated).mcp).toEqual({
      timeout: { startup: 30000 },
      servers: {
        other: { type: "remote", url: "https://example.com" },
        stagehand: {
          type: "local",
          command: [entry.command, ...entry.args],
          timeout: { startup: 60000, execution: 180000 },
          environment: { STAGEHAND_BROWSERBASE_VERIFIED: "true" },
        },
      },
    });
    expect(updateOpenCodeMcp(updated, entry)).toBe(updated);
  });
  it("replaces quoted TOML tables and scattered subtables, keeping the user's server env", () => {
    const raw =
      '# keep\n[mcp_servers."stagehand"]\ncommand="old"\nargs=["old.js"]\n[mcp_servers.other]\ncommand="other"\n[mcp_servers."stagehand".env]\nSTAGEHAND_BROWSERBASE_PROXIES="true"\n';
    const updated = updateTomlMcp(raw, entry);
    expect(updated).toContain("# keep");
    expect(parseToml(updated).mcp_servers).toEqual({
      other: { command: "other" },
      stagehand: {
        ...entry,
        startup_timeout_sec: 60,
        tool_timeout_sec: 180,
        env: { STAGEHAND_BROWSERBASE_PROXIES: "true" },
      },
    });
    expect(updateTomlMcp(updated, entry)).toBe(updated);
  });
  it("refreshes a moved JSON server entry while keeping the user's env", () => {
    const raw =
      '{"mcpServers":{"stagehand":{"command":"/old/node","args":["/old/browse/bin/run.js","mcp","--remote"],"env":{"BROWSERBASE_PROJECT_ID":"project"}}}}';
    expect(parseJsonc(updateJsonMcp(raw, entry, true)).mcpServers).toEqual({
      stagehand: {
        type: "stdio",
        ...entry,
        env: { BROWSERBASE_PROJECT_ID: "project" },
      },
    });
  });
  it("rejects ambiguous inline TOML instead of damaging the file", () => {
    expect(() =>
      updateTomlMcp(
        'mcp_servers = { stagehand = { command = "old" } }\n',
        entry,
      ),
    ).toThrow();
  });
});
