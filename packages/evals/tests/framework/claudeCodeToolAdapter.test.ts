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
  waitForCdpEvent,
} from "../../framework/claudeCodeToolAdapter.js";
import {
  resolveCodexStartupProfile,
  resolveCodexToolSurface,
} from "../../framework/codexToolAdapter.js";
import type { CdpEventMessage } from "../../core/tools/cdp_code.js";

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

  it("supports code tool surfaces as Claude Code run tools", () => {
    expect(resolveClaudeCodeToolSurface("playwright_code")).toBe(
      "playwright_code",
    );
    expect(resolveClaudeCodeStartupProfile("playwright_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(
      resolveClaudeCodeStartupProfile("playwright_code", "BROWSERBASE"),
    ).toBe("runner_provided_browserbase_cdp");
    expect(resolveClaudeCodeToolSurface("cdp_code")).toBe("cdp_code");
    expect(resolveClaudeCodeStartupProfile("cdp_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveClaudeCodeStartupProfile("cdp_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("rejects unsupported Claude Code tool surfaces for now", () => {
    expect(() => resolveClaudeCodeToolSurface("understudy_code")).toThrow(
      /supports --tool browse_cli, playwright_code, or cdp_code/,
    );
  });

  it("supports browse_cli as the first Codex tool surface", () => {
    expect(resolveCodexToolSurface()).toBe("browse_cli");
    expect(resolveCodexToolSurface("browse_cli")).toBe("browse_cli");
    expect(resolveCodexStartupProfile("browse_cli", "LOCAL")).toBe(
      "tool_launch_local",
    );
    expect(resolveCodexStartupProfile("browse_cli", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(() => resolveCodexToolSurface("playwright_code")).toThrow(
      /Codex harness supports --tool browse_cli/,
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

  it("keeps abandoned CDP event waits from becoming unhandled rejections", async () => {
    const listeners = new Set<(event: CdpEventMessage) => void>();
    const connection = {
      onEvent(listener: (event: CdpEventMessage) => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);
    try {
      const wait = waitForCdpEvent(
        connection as never,
        "session-1",
        "Page.frameNavigated",
        1,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);
      await expect(wait).rejects.toThrow(
        'Timed out waiting for CDP event "Page.frameNavigated"',
      );
      expect(listeners.size).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
