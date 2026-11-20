import os from "node:os";

import { describe, expect, it } from "vitest";

import { buildBugReportUrl, redactSensitive } from "../src/lib/bug-report.js";
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

    it("mentions --no-open flag", async () => {
      const result = await runCli(["bug", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--no-open");
    });

    it("mentions --title flag", async () => {
      const result = await runCli(["bug", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--title");
    });
  });

  describe("URL printing", () => {
    it("prints a GitHub issues URL", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("https://github.com/browserbase/stagehand/issues/new");
    });

    it("includes environment info in URL", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      const url = decodeURIComponent(result.stdout);
      expect(url).toContain("browse");
      expect(url).toContain("node");
      expect(url).toContain(process.platform);
    });

    it("includes issue template parameter", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("template=bug_report.md");
    });

    it("includes title when provided", async () => {
      const result = await runCli(["bug", "--no-open", "--title", "Test title"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("title=Test");
    });

    it("prints help message", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("fill in the details");
    });
  });

  describe("non-TTY and CI behavior", () => {
    it("prints URL and exits 0 when not a TTY", async () => {
      const result = await runCli(["bug"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("github.com/browserbase/stagehand/issues");
    });

    it("prints URL and exits 0 when CI is set", async () => {
      const result = await runCli(["bug"], { env: { CI: "true" } });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("github.com/browserbase/stagehand/issues");
    });
  });

  describe("--no-open flag", () => {
    it("prints URL when --no-open is provided", async () => {
      const result = await runCli(["bug", "--no-open"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("github.com/browserbase/stagehand/issues");
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

describe("buildBugReportUrl", () => {
  it("includes environment info", () => {
    const url = buildBugReportUrl({
      env: {
        browseVersion: "0.12.0",
        nodeVersion: "v22.18.0",
        os: "linux/x64",
        agent: "none",
      },
    });
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("0.12.0");
    expect(decoded).toContain("v22.18.0");
    expect(decoded).toContain("linux/x64");
  });

  it("includes title when provided", () => {
    const url = buildBugReportUrl({
      title: "Test bug",
      env: {
        browseVersion: "0.12.0",
        nodeVersion: "v22.18.0",
        os: "linux/x64",
        agent: "none",
      },
    });
    expect(url).toContain("title=Test+bug");
  });

  it("uses bug report template", () => {
    const url = buildBugReportUrl({
      env: {
        browseVersion: "0.12.0",
        nodeVersion: "v22.18.0",
        os: "linux/x64",
        agent: "none",
      },
    });
    expect(url).toContain("template=bug_report.md");
  });
});

describe("redactSensitive", () => {
  it("redacts Browserbase API keys", () => {
    expect(redactSensitive("key: bb_live_abc123")).toBe("key: [REDACTED_API_KEY]");
    expect(redactSensitive("key: bb_test_xyz789")).toBe("key: [REDACTED_API_KEY]");
  });

  it("redacts OpenAI-style keys", () => {
    expect(redactSensitive("sk-abcdefghijklmnopqrstuvwxyz")).toBe("[REDACTED_KEY]");
  });

  it("redacts Bearer tokens", () => {
    expect(redactSensitive("Authorization: Bearer abc123.xyz")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
  });

  it("redacts URL parameters", () => {
    expect(redactSensitive("https://example.com?token=secret123")).toBe(
      "https://example.com?token=[REDACTED]",
    );
    expect(redactSensitive("https://example.com?sig=abc123")).toBe(
      "https://example.com?sig=[REDACTED]",
    );
  });

  it("redacts home directory paths", () => {
    const home = os.homedir();
    expect(redactSensitive(`${home}/projects/test`)).toBe("~/projects/test");
  });

  it("preserves non-sensitive content", () => {
    expect(redactSensitive("browse snapshot")).toBe("browse snapshot");
    expect(redactSensitive("Error: timeout")).toBe("Error: timeout");
  });
});
