import { describe, expect, it } from "vitest";

import { runCli } from "./helpers/run-cli.js";

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
    const result = await runCli(["skills", "show"], { cwd: "/tmp" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name: browse");
  });
});
