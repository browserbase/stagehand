import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./helpers/run-cli.js";

const surfaceCleanup: string[] = [];

async function homeWithoutSkill(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "browse-banner-noskill-"));
  surfaceCleanup.push(home);
  return home;
}

async function homeWithSkill(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "browse-banner-skill-"));
  surfaceCleanup.push(home);
  const dir = join(home, ".agents", "skills", "browse");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), "---\nname: browse\n---\n", "utf8");
  return home;
}

const cloudCommandsWithExamples = [
  ["cloud", "projects", "list"],
  ["cloud", "projects", "get"],
  ["cloud", "projects", "usage"],
  ["cloud", "sessions", "list"],
  ["cloud", "sessions", "get"],
  ["cloud", "sessions", "create"],
  ["cloud", "sessions", "update"],
  ["cloud", "sessions", "debug"],
  ["cloud", "sessions", "logs"],
  ["cloud", "sessions", "downloads", "get"],
  ["cloud", "sessions", "uploads", "create"],
  ["cloud", "contexts", "create"],
  ["cloud", "contexts", "get"],
  ["cloud", "contexts", "update"],
  ["cloud", "contexts", "delete"],
  ["cloud", "extensions", "upload"],
  ["cloud", "extensions", "get"],
  ["cloud", "extensions", "delete"],
  ["cloud", "fetch"],
  ["cloud", "search"],
];

const functionsCommandsWithExamples = [
  ["functions", "init"],
  ["functions", "dev"],
  ["functions", "publish"],
  ["functions", "invoke"],
];

const templatesCommandsWithExamples = [
  ["templates", "list"],
  ["templates", "find"],
  ["templates", "clone"],
];

const skillsCommandsWithExamples = [
  ["skills", "add"],
  ["skills", "find"],
  ["skills", "install"],
  ["skills", "list"],
];

describe("CLI surface", () => {
  afterEach(async () => {
    while (surfaceCleanup.length > 0) {
      const path = surfaceCleanup.pop();
      if (path) await rm(path, { recursive: true, force: true });
    }
  });

  it("prints browse root help", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("$ browse");
    expect(result.stdout).toContain("Unified Browserbase CLI");
    expect(result.stdout).toContain("cloud");
    expect(result.stdout).toContain("functions");
    expect(result.stdout).toContain("templates");
    expect(result.stdout).toContain("skills");
  });

  it("shows the skill banner on root help when the skill is not installed", async () => {
    const result = await runCli(["--help"], {
      env: { HOME: await homeWithoutSkill() },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Start here (for AI agents)");
  });

  it("shows the skill banner on root help even when the skill is installed", async () => {
    const result = await runCli(["--help"], {
      env: { HOME: await homeWithSkill() },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Start here (for AI agents)");
    expect(result.stdout).toContain("Unified Browserbase CLI");
  });

  it("prints cloud topic help", async () => {
    const result = await runCli(["cloud", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("$ browse cloud");
    expect(result.stdout).toContain(
      "Manage Browserbase cloud resources and APIs.",
    );
  });

  it("prints cloud topic help when invoked without a subcommand", async () => {
    const result = await runCli(["cloud"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("$ browse cloud");
    expect(result.stdout).toContain("cloud projects");
    expect(result.stdout).toContain("cloud sessions");
  });

  it.each(cloudCommandsWithExamples)(
    "prints descriptive help for %j",
    async (...command) => {
      const result = await runCli([...command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("FLAGS");
      expect(result.stdout).toContain("EXAMPLES");
    },
  );

  it("shows --verified and hides --advanced-stealth for sessions create", async () => {
    const result = await runCli(["cloud", "sessions", "create", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--verified");
    expect(result.stdout).not.toContain("--advanced-stealth");
  });

  it("prints functions topic help", async () => {
    const result = await runCli(["functions"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("$ browse functions");
    expect(result.stdout).toContain("functions init");
    expect(result.stdout).toContain("functions publish");
  });

  it.each(functionsCommandsWithExamples)(
    "prints descriptive help for %j",
    async (...command) => {
      const result = await runCli([...command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("FLAGS");
      expect(result.stdout).toContain("EXAMPLES");
    },
  );

  it("prints templates topic help", async () => {
    const result = await runCli(["templates"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("$ browse templates");
    expect(result.stdout).toContain("templates list");
    expect(result.stdout).toContain("templates clone");
  });

  it.each(templatesCommandsWithExamples)(
    "prints descriptive help for %j",
    async (...command) => {
      const result = await runCli([...command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("FLAGS");
      expect(result.stdout).toContain("EXAMPLES");
    },
  );

  it("prints skills topic help", async () => {
    const result = await runCli(["skills"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("$ browse skills");
    expect(result.stdout).toContain("skills add");
    expect(result.stdout).toContain("skills find");
    expect(result.stdout).toContain("skills install");
    expect(result.stdout).toContain("skills list");
  });

  it.each(skillsCommandsWithExamples)(
    "prints descriptive help for %j",
    async (...command) => {
      const result = await runCli([...command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("EXAMPLES");
    },
  );
});
