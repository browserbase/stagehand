import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getBrowseCliAllowedTools,
  getBrowseCliToolMetadata,
  insertAfterFrontmatter,
  isAllowedBrowseCommand,
  installBrowseSkill,
  resolveClaudeCodeStartupProfile,
  resolveClaudeCodeToolSurface,
  waitForCdpEvent,
} from "../../framework/claudeCodeToolAdapter.js";
import {
  resolveCodexStartupProfile,
  resolveCodexToolSurface,
} from "../../framework/codexToolAdapter.js";
import { getRepoRootDir } from "../../runtimePaths.js";
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
      browseCliEntrypoint: expect.stringContaining("packages/cli/bin/run.js"),
    });
  });

  it("installs the browse skill as a project skill", async () => {
    const cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), "stagehand-evals-skill-test-"),
    );
    try {
      await installBrowseSkill(cwd);
      const skill = await fsp.readFile(
        path.join(cwd, ".claude", "skills", "browse", "SKILL.md"),
        "utf8",
      );
      // The installed skill is the real CLI skill (single source of truth)...
      expect(skill).toContain("name: browse");
      expect(skill).toContain("browse CLI");
      // ...plus the install-time eval-harness addendum, inserted right after
      // frontmatter so it precedes (and overrides) the CLI skill's
      // conflicting cloud/functions/templates/skills-install examples.
      expect(skill).toContain("## Eval Harness Addendum");
      expect(skill).toContain("EVAL_RESULT");
      const addendumIndex = skill.indexOf("## Eval Harness Addendum");
      const cloudSectionIndex = skill.indexOf("## Cloud APIs");
      expect(addendumIndex).toBeGreaterThan(-1);
      expect(cloudSectionIndex).toBeGreaterThan(-1);
      expect(addendumIndex).toBeLessThan(cloudSectionIndex);
    } finally {
      await fsp.rm(cwd, { recursive: true, force: true });
    }
  });

  it("inserts after LF frontmatter", () => {
    const markdown = "---\nname: browse\n---\n# Body\ntext\n";
    const result = insertAfterFrontmatter(markdown, "ADDENDUM");
    expect(result).toBe("---\nname: browse\n---\nADDENDUM\n# Body\ntext\n");
  });

  it("inserts after CRLF frontmatter", () => {
    const markdown = "---\r\nname: browse\r\n---\r\n# Body\r\ntext\r\n";
    const result = insertAfterFrontmatter(markdown, "ADDENDUM");
    expect(result).toBe(
      "---\r\nname: browse\r\n---\r\nADDENDUM\n# Body\r\ntext\r\n",
    );
  });

  it("inserts after BOM-prefixed frontmatter", () => {
    const bom = "﻿";
    const markdown = `${bom}---\nname: browse\n---\n# Body\ntext\n`;
    const result = insertAfterFrontmatter(markdown, "ADDENDUM");
    // The BOM is part of the original source bytes preceding the body, so
    // it stays put ahead of the addendum rather than being dropped or
    // relocated by gray-matter's internal (content-only) BOM stripping.
    expect(result).toBe(
      `${bom}---\nname: browse\n---\nADDENDUM\n# Body\ntext\n`,
    );
    expect(result.startsWith(bom)).toBe(true);
  });

  it("inserts after frontmatter containing a `---` line inside a YAML multiline string", () => {
    const markdown = [
      "---",
      "name: browse",
      "description: >",
      "  first line",
      "  ---",
      "  still frontmatter",
      "---",
      "# Body",
      "text",
      "",
    ].join("\n");
    const result = insertAfterFrontmatter(markdown, "ADDENDUM");
    const expectedFrontmatter = [
      "---",
      "name: browse",
      "description: >",
      "  first line",
      "  ---",
      "  still frontmatter",
      "---",
      "",
    ].join("\n");
    expect(result).toBe(`${expectedFrontmatter}ADDENDUM\n# Body\ntext\n`);
    // The embedded `---` must not be mistaken for the closing delimiter.
    expect(result.indexOf("ADDENDUM")).toBeGreaterThan(
      result.indexOf("still frontmatter"),
    );
  });

  it("falls back to prepending when there is no frontmatter", () => {
    const markdown = "# Just a body\nno frontmatter here\n";
    const result = insertAfterFrontmatter(markdown, "ADDENDUM");
    expect(result).toBe("ADDENDUM\n# Just a body\nno frontmatter here\n");
  });

  it("falls back to prepending when frontmatter is unterminated and invalid YAML", () => {
    // No closing `---` and not parseable as YAML (an implicit multiline key)
    // -- gray-matter throws here; we must not propagate that during install.
    const markdown = "---\nname: x\nunterminated body text\n";
    const result = insertAfterFrontmatter(markdown, "ADDENDUM");
    expect(result).toBe(`ADDENDUM\n${markdown}`);
  });

  it("keeps the installed skill's frontmatter byte-identical to the source SKILL.md", async () => {
    const sourcePath = path.join(
      getRepoRootDir(),
      "packages",
      "cli",
      "skills",
      "browse",
      "SKILL.md",
    );
    const source = await fsp.readFile(sourcePath, "utf8");
    const sourceFrontmatterMatch = source.match(/^[\s\S]*?\n---\n/);
    expect(sourceFrontmatterMatch).not.toBeNull();
    const sourceFrontmatter = sourceFrontmatterMatch![0];

    const cwd = await fsp.mkdtemp(
      path.join(os.tmpdir(), "stagehand-evals-skill-fidelity-test-"),
    );
    try {
      await installBrowseSkill(cwd);
      const installed = await fsp.readFile(
        path.join(cwd, ".claude", "skills", "browse", "SKILL.md"),
        "utf8",
      );
      // Regression guard: this must be a raw-bytes reassembly, not a
      // matter.stringify() round-trip -- a js-yaml re-serialization would
      // reformat the folded `description: >` block and other YAML
      // formatting choices in the shipped skill.
      expect(installed.slice(0, sourceFrontmatter.length)).toBe(
        sourceFrontmatter,
      );
      expect(installed.startsWith(sourceFrontmatter)).toBe(true);
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
