import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";
import { DISCORD_INVITE_URL } from "../src/lib/support-links.js";

describe("browse discord", () => {
  describe("help text", () => {
    it("shows in root help", async () => {
      const result = await runCli(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("discord");
    });

    it("has descriptive help", async () => {
      const result = await runCli(["discord", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("system browser");
      expect(result.stdout).toContain("not a browse session");
    });

    it("mentions --no-open flag", async () => {
      const result = await runCli(["discord", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--no-open");
    });
  });

  describe("URL printing", () => {
    it("prints the Discord URL", async () => {
      const result = await runCli(["discord", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(DISCORD_INVITE_URL);
    });

    it("prints a community invitation", async () => {
      const result = await runCli(["discord", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("contribute to Stagehand and the Browse CLI");
      expect(result.stdout).toContain("share");
    });
  });

  describe("non-TTY and CI behavior", () => {
    it("prints URL and exits 0 when not a TTY", async () => {
      // runCli spawns a child process where stdout is piped (not a TTY),
      // so the browser should not be opened automatically
      const result = await runCli(["discord"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(DISCORD_INVITE_URL);
    });

    it("prints URL and exits 0 when CI is set", async () => {
      const result = await runCli(["discord"], { env: { CI: "true" } });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(DISCORD_INVITE_URL);
    });
  });

  describe("--no-open flag", () => {
    it("prints URL without attempting to open browser", async () => {
      const result = await runCli(["discord", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(DISCORD_INVITE_URL);
    });
  });

  describe("no driver interaction", () => {
    it("does not call any driver commands", async () => {
      // The command should complete without needing a browser session
      const result = await runCli(["discord", "--no-open"]);
      expect(result.exitCode).toBe(0);
      // Should not contain driver-related errors
      expect(result.stderr).not.toContain("daemon");
      expect(result.stderr).not.toContain("session");
      expect(result.stderr).not.toContain("browser");
    });
  });
});
