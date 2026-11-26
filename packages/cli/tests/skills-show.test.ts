import { rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "./helpers/run-cli.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillMdPath = join(repoRoot, "skills", "browse", "SKILL.md");

describe("skills show", () => {
  it("prints the bundled browse skill to stdout", async () => {
    const result = await runCli(["skills", "show"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name: browse");
    expect(result.stdout).toContain("# Browse CLI");
  });

  it("resolves the bundled skill from a different working directory", async () => {
    const result = await runCli(["skills", "show"], { cwd: tmpdir() });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name: browse");
  });

  it("fails cleanly with a non-zero exit when the bundled SKILL.md is missing", async () => {
    const movedPath = `${skillMdPath}.moved-for-test`;
    await rename(skillMdPath, movedPath);
    try {
      const result = await runCli(["skills", "show"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Could not read the bundled browse skill (SKILL.md)");
    } finally {
      await rename(movedPath, skillMdPath);
    }
  });
});
