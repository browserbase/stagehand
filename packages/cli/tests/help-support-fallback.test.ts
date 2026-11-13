import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { DISCORD_INVITE_URL, GITHUB_ISSUES_URL } from "../src/lib/support-links.js";

describe("help footer", () => {
  it("shows Discord and GitHub links on root help", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("COMMUNITY");
    expect(result.stdout).toContain(DISCORD_INVITE_URL);
    expect(result.stdout).toContain(GITHUB_ISSUES_URL);
    expect(result.stdout).toContain("Report a bug");
  });

  it("shows footer on bare browse invocation", async () => {
    const result = await runCli([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(DISCORD_INVITE_URL);
    expect(result.stdout).toContain(GITHUB_ISSUES_URL);
  });

  it("does not show footer on subcommand help", async () => {
    const result = await runCli(["open", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("COMMUNITY");
    expect(result.stdout).not.toContain(GITHUB_ISSUES_URL);
  });

  it("does not show footer on topic help", async () => {
    const result = await runCli(["cloud", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("COMMUNITY");
    expect(result.stdout).not.toContain(GITHUB_ISSUES_URL);
  });
});

describe("error support hint", () => {
  it("prints both support links to stderr for an unexpected runtime error", async () => {
    const baseUrl = new URL("../dist/base.js", import.meta.url).href;
    const result = await runCli(
      [
        "--input-type=module",
        "--eval",
        `import { handle } from "@oclif/core";
         import { BrowseCommand } from ${JSON.stringify(baseUrl)};
         class FailingCommand extends BrowseCommand {
           async run() {
             throw new Error("Unexpected test failure");
           }
         }
         await FailingCommand.run([], process.cwd()).catch(handle);`,
      ],
      { executable: process.execPath },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unexpected test failure");
    expect(result.stderr).toContain(DISCORD_INVITE_URL);
    expect(result.stderr).toContain(GITHUB_ISSUES_URL);
  });

  it("does not show support hint for usage errors", async () => {
    // Missing required argument - this is a usage error
    const result = await runCli(["cloud", "sessions", "get"]);
    expect(result.exitCode).not.toBe(0);
    // Oclif usage errors should not trigger the support hint
    expect(result.stderr).not.toContain("Get help:");
    expect(result.stderr).not.toContain(DISCORD_INVITE_URL);
  });

  it("does not show support hint for command-not-found", async () => {
    const result = await runCli(["nonexistent-command"]);
    expect(result.exitCode).not.toBe(0);
    // Command not found errors are handled by the hook, not catch()
    expect(result.stderr).not.toContain("Get help:");
  });

  it("does not show support hint for expected CommandFailure errors", async () => {
    // This triggers a CommandFailure with a resultCode (expected error)
    // e.g., invalid skill id
    const result = await runCli(["skills", "add", "invalid"]);
    expect(result.exitCode).not.toBe(0);
    // CommandFailure is an expected error, should not show support hint
    expect(result.stderr).not.toContain("Get help:");
  });
});
