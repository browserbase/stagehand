import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getBrowseCliAllowedTools,
  getBrowseCliToolMetadata,
  isAllowedBrowseCommand,
  installBrowserSkill,
  resolveClaudeCodeStartupProfile,
  resolveClaudeCodeToolSurface,
} from "../../framework/claudeCodeToolAdapter.js";

describe("claude code tool adapter resolution", () => {
  afterEach(() => {
    delete process.env.EVAL_CLAUDE_CODE_ALLOW_UNSANDBOXED_LOCAL;
  });

  it("defaults Claude Code to browse_cli", () => {
    expect(resolveClaudeCodeToolSurface()).toBe("browse_cli");
  });

  it("defaults browse_cli startup by environment", () => {
    expect(resolveClaudeCodeStartupProfile("browse_cli", "LOCAL")).toBe(
      "tool_launch_local",
    );
    expect(resolveClaudeCodeStartupProfile("browse_cli", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
  });

  it("rejects unsupported Claude Code tool surfaces for now", () => {
    expect(() => resolveClaudeCodeToolSurface("understudy_code")).toThrow(
      /supports --tool browse_cli/,
    );
  });

  it("allows only direct browse commands through Bash", () => {
    expect(isAllowedBrowseCommand("browse -h")).toBe(true);
    expect(isAllowedBrowseCommand("browse open https://example.com")).toBe(
      true,
    );
    expect(isAllowedBrowseCommand("./browse -h")).toBe(false);
    expect(isAllowedBrowseCommand("npm test")).toBe(false);
    expect(isAllowedBrowseCommand("browse status; rm -rf /")).toBe(false);
    expect(isAllowedBrowseCommand("browse status\ncat ~/.ssh/id_rsa")).toBe(
      false,
    );
    expect(isAllowedBrowseCommand("browse status\r\ncat ~/.ssh/id_rsa")).toBe(
      false,
    );
  });

  it("does not auto-allow raw Bash unless unsandboxed local mode is explicit", () => {
    expect(getBrowseCliAllowedTools()).toEqual(["Skill"]);

    process.env.EVAL_CLAUDE_CODE_ALLOW_UNSANDBOXED_LOCAL = "true";
    expect(getBrowseCliAllowedTools()).toEqual(["Skill", "Bash"]);
  });

  it("exposes browse cli metadata for Braintrust rows", () => {
    expect(getBrowseCliToolMetadata()).toMatchObject({
      toolCommand: "browse",
      browseCliVersion: expect.any(String),
      browseCliEntrypoint: expect.stringContaining(
        "packages/cli/dist/index.js",
      ),
    });
  });

  it("installs the browser skill as a project skill", async () => {
    const cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), "stagehand-evals-skill-test-"),
    );
    try {
      await installBrowserSkill(cwd);
      const skill = await fsp.readFile(
        path.join(cwd, ".claude", "skills", "browser", "SKILL.md"),
        "utf8",
      );
      expect(skill).toContain("name: browser");
      expect(skill).toContain("browse CLI");
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true });
    }
  });
});
