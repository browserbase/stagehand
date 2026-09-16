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
    // The command resolves SKILL.md relative to its own module location, not
    // the process cwd, so it must work regardless of where `browse` is run
    // from (e.g. an agent invoking it from an arbitrary project directory).
    // Use the OS temp dir rather than a hardcoded POSIX path so this also
    // runs on Windows CI.
    const result = await runCli(["skills", "show"], { cwd: tmpdir() });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name: browse");
  });

  it("fails cleanly with a non-zero exit when the bundled SKILL.md is missing", async () => {
    // Temporarily move the real bundled SKILL.md aside to exercise the
    // missing-file error path against the actual resolved path, then always
    // restore it so other tests (and the package itself) are unaffected.
    // Safe because vitest.config.ts sets fileParallelism: false -- no other
    // test file can be mid-run against this file concurrently.
    const movedPath = `${skillMdPath}.moved-for-test`;
    await rename(skillMdPath, movedPath);
    try {
      const result = await runCli(["skills", "show"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Could not read the bundled browse skill (SKILL.md)",
      );
    } finally {
      await rename(movedPath, skillMdPath);
    }
  });
});
