import { describe, expect, it } from "vitest";
import { runCli } from "./helpers/run-cli.js";

describe("browse issues", () => {
  describe("help text", () => {
    it("shows in root help", async () => {
      const result = await runCli(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("issues");
    });

    it("has descriptive help", async () => {
      const result = await runCli(["issues", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("GitHub issues");
    });

    it("mentions --no-open flag", async () => {
      const result = await runCli(["issues", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--no-open");
    });

    it("shows bug alias", async () => {
      const result = await runCli(["issues", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bug");
    });
  });

  describe("URL printing", () => {
    it("prints the GitHub issues URL with UTM params", async () => {
      const result = await runCli(["issues", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("github.com/browserbase/stagehand/issues");
      expect(result.stdout).toContain("utm_source=browse_cli");
      expect(result.stdout).toContain("utm_medium=issues_command");
    });

    it("prints a helpful message", async () => {
      const result = await runCli(["issues", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Report bugs");
      expect(result.stdout).toContain("request features");
    });
  });

  describe("bug alias", () => {
    it("works as alias for issues", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("github.com/browserbase/stagehand/issues");
    });
  });

  describe("non-TTY and CI behavior", () => {
    it("prints URL and exits 0 when not a TTY", async () => {
      const result = await runCli(["issues"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("github.com/browserbase/stagehand/issues");
    });

    it("prints URL and exits 0 when CI is set", async () => {
      const result = await runCli(["issues"], { env: { CI: "true" } });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("github.com/browserbase/stagehand/issues");
    });
  });

  describe("--no-open flag", () => {
    it("prints URL when --no-open is provided", async () => {
      const result = await runCli(["issues", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("github.com/browserbase/stagehand/issues");
    });
  });

  describe("no driver interaction", () => {
    it("does not call any driver commands", async () => {
      const result = await runCli(["issues", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("daemon");
      expect(result.stderr).not.toContain("session");
    });
  });
});
