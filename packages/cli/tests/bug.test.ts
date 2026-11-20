import { describe, expect, it } from "vitest";

import { runCli } from "./helpers/run-cli.js";

describe("browse bug", () => {
  describe("help text", () => {
    it("shows in root help", async () => {
      const result = await runCli(["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("bug");
    });

    it("has descriptive help", async () => {
      const result = await runCli(["bug", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("GitHub issue");
      expect(result.stdout).toContain("not a browse session");
    });
  });

  describe("URL printing", () => {
    it("prints a GitHub issues URL with --no-open", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("https://github.com/browserbase/stagehand/issues/new");
    });

    it("includes version and OS in URL body", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      const decoded = decodeURIComponent(result.stdout).replace(/\+/g, " ");
      expect(decoded).toContain("browse |");
      expect(decoded).toContain("node |");
      expect(decoded).toContain(process.platform);
      expect(decoded).toContain("agent |");
    });

    it("includes title when provided", async () => {
      const result = await runCli(["bug", "--no-open", "--title", "Test title"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("title=Test");
    });
  });

  describe("no driver interaction", () => {
    it("does not call any driver commands", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("daemon");
      expect(result.stderr).not.toContain("session");
      expect(result.stderr).not.toContain("browser");
    });
  });
});
