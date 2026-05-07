/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFile);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const CLI_PATH = path.join(repoRoot, "packages", "evals", "cli.ts");
const SOURCE_CONFIG = path.join(
  repoRoot,
  "packages",
  "evals",
  "evals.config.json",
);

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      ["--import", "tsx", CLI_PATH, ...args],
      {
        cwd: repoRoot,
        timeout: 15_000,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      },
    );
    return { stdout, stderr, code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.code ?? 1,
    };
  }
}

describe("CLI entrypoint", () => {
  it("shows help", async () => {
    const { stdout, code } = await runCli(["-h"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("run");
    expect(stdout).toContain("list");
    expect(stdout).toContain("config");
    expect(stdout).toContain("experiments");
  });

  it("shows experiments overview help", async () => {
    const { stdout, code } = await runCli(["experiments"]);
    expect(code).toBe(0);
    expect(stdout).toContain("evals experiments");
    expect(stdout).toContain("list");
    expect(stdout).toContain("show");
    expect(stdout).toContain("open");
    expect(stdout).toContain("compare");
  });

  it("shows experiments compare help", async () => {
    const { stdout, code } = await runCli(["experiments", "compare", "-h"]);
    expect(code).toBe(0);
    expect(stdout).toContain("evals experiments compare");
    expect(stdout).toContain("--project");
    expect(stdout).toContain("--out");
  });

  // Help is reachable three ways at every level: `--help`, `-h`, and the
  // bare word `help` as the first positional after the verb. Each row pairs
  // an argv with a substring that must appear in the resulting help output.
  const helpCases: Array<{ args: string[]; contains: string }> = [
    { args: ["help"], contains: "Commands:" },
    { args: ["--help"], contains: "Commands:" },
    { args: ["-h"], contains: "Commands:" },
    { args: ["run", "help"], contains: "evals run" },
    { args: ["run", "--help"], contains: "evals run" },
    { args: ["run", "-h"], contains: "evals run" },
    { args: ["list", "help"], contains: "evals list" },
    { args: ["list", "--help"], contains: "evals list" },
    { args: ["list", "-h"], contains: "evals list" },
    { args: ["new", "help"], contains: "evals new" },
    { args: ["new", "--help"], contains: "evals new" },
    { args: ["new", "-h"], contains: "evals new" },
    { args: ["config", "help"], contains: "evals config" },
    { args: ["config", "--help"], contains: "evals config" },
    { args: ["config", "-h"], contains: "evals config" },
    { args: ["config", "set", "help"], contains: "evals config" },
    { args: ["config", "set", "--help"], contains: "evals config" },
    { args: ["config", "reset", "help"], contains: "evals config" },
    { args: ["config", "path", "help"], contains: "evals config" },
    { args: ["config", "core", "help"], contains: "evals config core" },
    { args: ["config", "core", "--help"], contains: "evals config core" },
    { args: ["config", "core", "-h"], contains: "evals config core" },
    { args: ["config", "core", "set", "help"], contains: "evals config core" },
    {
      args: ["config", "core", "set", "--help"],
      contains: "evals config core",
    },
    {
      args: ["config", "core", "reset", "help"],
      contains: "evals config core",
    },
    { args: ["config", "core", "path", "help"], contains: "evals config core" },
    {
      args: ["config", "core", "setup", "help"],
      contains: "evals config core",
    },
    { args: ["experiments", "help"], contains: "evals experiments" },
    { args: ["experiments", "--help"], contains: "evals experiments" },
    { args: ["experiments", "-h"], contains: "evals experiments" },
    {
      args: ["experiments", "list", "help"],
      contains: "evals experiments list",
    },
    {
      args: ["experiments", "list", "--help"],
      contains: "evals experiments list",
    },
    {
      args: ["experiments", "show", "help"],
      contains: "evals experiments show",
    },
    {
      args: ["experiments", "open", "help"],
      contains: "evals experiments open",
    },
    {
      args: ["experiments", "compare", "help"],
      contains: "evals experiments compare",
    },
  ];

  it.each(helpCases)(
    "accepts $args as a help invocation",
    async ({ args, contains }) => {
      const { stdout, code } = await runCli(args);
      expect(code).toBe(0);
      expect(stdout).toContain(contains);
    },
  );

  // Regression: help interception must not reach into value positions.
  // `config set <key> <value>` must surface a parse/value error, not silently
  // print help — otherwise `--help` would be a magical sentinel anywhere.
  it("does not swallow `--help` as a value in `config set`", async () => {
    const { stdout, stderr, code } = await runCli([
      "config",
      "set",
      "trials",
      "--help",
    ]);
    expect(code).toBe(1);
    const output = stdout + stderr;
    expect(output).not.toContain("Commands:");
    expect(output).toContain("trials must be a positive integer");
  });

  it("exports resolved bench flags into env overrides during dry-run", async () => {
    const { stdout, code } = await runCli([
      "run",
      "act",
      "--dry-run",
      "-e",
      "browserbase",
      "--api",
      "-p",
      "openai",
    ]);

    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.normalizedTarget).toBe("act");
    expect(payload.envOverrides.EVAL_ENV).toBe("BROWSERBASE");
    expect(payload.envOverrides.USE_API).toBe("true");
    expect(payload.envOverrides.EVAL_PROVIDER).toBe("openai");
    expect(payload.runOptions.harness).toBe("stagehand");
    expect(payload.runOptions.verbose).toBe(false);
  });

  it("renders --preview as a human-readable plan", async () => {
    const { stdout, code } = await runCli(["run", "act", "--preview"]);
    expect(code).toBe(0);

    // Header + sections — strip ANSI before substring checks.
    // eslint-disable-next-line no-control-regex
    const plain = stdout.replace(/\[[0-9;]*m/g, "");
    expect(plain).toMatch(/Target:\s+act/);
    expect(plain).toMatch(/Combinations \(/);
    expect(plain).toMatch(/Tasks \(/);
    expect(plain).toMatch(/Total:\s+\d+ run/);
    // Should NOT be JSON.
    expect(() => JSON.parse(stdout)).toThrow();
  });

  it("rejects --preview combined with --dry-run", async () => {
    const { stdout, stderr, code } = await runCli([
      "run",
      "act",
      "--dry-run",
      "--preview",
    ]);
    expect(code).toBe(1);
    expect(stdout + stderr).toContain(
      "--preview and --dry-run are mutually exclusive",
    );
  });

  it("fails fast on unknown flags instead of consuming the target", async () => {
    const { stdout, stderr, code } = await runCli([
      "run",
      "--envr",
      "browserbase",
      "act",
      "--dry-run",
    ]);

    expect(code).toBe(1);
    expect(stdout + stderr).toContain('Unknown option "--envr"');
  });

  it("returns a non-zero exit code for invalid targets", async () => {
    const { stdout, stderr, code } = await runCli([
      "run",
      "nonexistent_eval_xyz",
    ]);

    expect(code).toBe(1);
    expect(stdout + stderr).toContain(
      'No tasks found matching "nonexistent_eval_xyz"',
    );
  });

  it("prints the source config path in source mode", async () => {
    const { stdout, code } = await runCli(["config", "path"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(
      path.join(repoRoot, "packages", "evals", "evals.config.json"),
    );
  });
});

describe.sequential("core config", () => {
  // Tests mutate packages/evals/evals.config.json. Snapshot beforeAll,
  // reset to snapshot before each test, restore afterAll.
  let snapshot: string;

  beforeAll(() => {
    snapshot = fs.readFileSync(SOURCE_CONFIG, "utf-8");
  });

  afterAll(() => {
    fs.writeFileSync(SOURCE_CONFIG, snapshot);
  });

  function resetConfig(): void {
    fs.writeFileSync(SOURCE_CONFIG, snapshot);
  }

  it("prints placeholder when no core section exists", async () => {
    resetConfig();
    const { stdout, code } = await runCli(["config", "core"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Core configuration");
    expect(stdout).toContain("runner default: understudy_code");
  });

  it("persists tool via `config core set tool`", async () => {
    resetConfig();
    const setResult = await runCli([
      "config",
      "core",
      "set",
      "tool",
      "understudy_code",
    ]);
    expect(setResult.code).toBe(0);
    expect(setResult.stdout).toContain("Set core.tool to understudy_code");

    const saved = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf-8"));
    expect(saved.core?.tool).toBe("understudy_code");
  });

  it("flows persisted core.tool into run dry-run output", async () => {
    resetConfig();
    await runCli(["config", "core", "set", "tool", "understudy_code"]);

    const { stdout, code } = await runCli([
      "run",
      "navigation/open",
      "--dry-run",
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.runOptions.coreToolSurface).toBe("understudy_code");
  });

  it("rejects unknown tool", async () => {
    resetConfig();
    const { stdout, stderr, code } = await runCli([
      "config",
      "core",
      "set",
      "tool",
      "not_a_real_tool",
    ]);
    expect(code).toBe(1);
    expect(stdout + stderr).toContain('Invalid tool "not_a_real_tool"');
  });

  it("rejects setting startup without a tool", async () => {
    resetConfig();
    const { stdout, stderr, code } = await runCli([
      "config",
      "core",
      "set",
      "startup",
      "tool_launch_local",
    ]);
    expect(code).toBe(1);
    expect(stdout + stderr).toContain("Cannot set startup without a tool");
  });

  it("rejects startup unsupported by the chosen tool", async () => {
    resetConfig();
    // cdp_code does not support tool_create_browserbase.
    await runCli(["config", "core", "set", "tool", "cdp_code"]);
    const { stdout, stderr, code } = await runCli([
      "config",
      "core",
      "set",
      "startup",
      "tool_create_browserbase",
    ]);
    expect(code).toBe(1);
    expect(stdout + stderr).toContain(
      'Tool "cdp_code" does not support startup',
    );
  }, 30_000);

  it("auto-resets startup when a tool change invalidates it", async () => {
    resetConfig();
    // cdp_code supports tool_attach_local_cdp; browse_cli does not.
    await runCli(["config", "core", "set", "tool", "cdp_code"]);
    await runCli(["config", "core", "set", "startup", "tool_attach_local_cdp"]);
    const { stdout, code } = await runCli([
      "config",
      "core",
      "set",
      "tool",
      "browse_cli",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("Resetting startup");

    const saved = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf-8"));
    expect(saved.core?.tool).toBe("browse_cli");
    expect(saved.core?.startup).toBeUndefined();
  }, 30_000);

  it("reset clears the whole core section", async () => {
    resetConfig();
    await runCli(["config", "core", "set", "tool", "understudy_code"]);
    const { code } = await runCli(["config", "core", "reset"]);
    expect(code).toBe(0);

    const saved = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf-8"));
    expect(saved.core).toBeUndefined();
  }, 15_000);
});
