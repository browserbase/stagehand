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
  waitForCdpEvent,
} from "../../framework/claudeCodeToolAdapter.js";
import type { CdpEventMessage } from "../../core/tools/cdp_code.js";
import { claudeCodeHarness, codexHarness } from "../../framework/benchHarness.js";
import {
  resolveStartupProfile,
  resolveToolSurface,
} from "../../framework/harnesses/toolSurfaceResolution.js";

describe("claude code tool adapter resolution", () => {
  afterEach(() => {
    delete process.env.EVAL_CLAUDE_CODE_ALLOW_UNSANDBOXED_LOCAL;
  });

  it("defaults Claude Code to browse_cli", () => {
    expect(resolveToolSurface(claudeCodeHarness)).toBe("browse_cli");
  });

  it("defaults browse_cli startup by environment", () => {
    expect(resolveStartupProfile("browse_cli", "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile("browse_cli", "BROWSERBASE")).toBe("tool_create_browserbase");
  });

  it("supports code tool surfaces as Claude Code run tools", () => {
    expect(resolveToolSurface(claudeCodeHarness, "playwright_code")).toBe("playwright_code");
    expect(resolveStartupProfile("playwright_code", "LOCAL")).toBe("runner_provided_local_cdp");
    expect(resolveStartupProfile("playwright_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveToolSurface(claudeCodeHarness, "cdp_code")).toBe("cdp_code");
    expect(resolveStartupProfile("cdp_code", "LOCAL")).toBe("runner_provided_local_cdp");
    expect(resolveStartupProfile("cdp_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("rejects unsupported Claude Code tool surfaces for now", () => {
    expect(() => resolveToolSurface(claudeCodeHarness, "understudy_code")).toThrow(
      /Harness "claude_code" supports --tool browse_cli, playwright_code, cdp_code, stagehand_code, playwright_mcp, chrome_devtools_mcp, or stagehand_facade; received "understudy_code"/,
    );
  });

  it("supports the MCP surfaces with runner-provided startup profiles", () => {
    expect(resolveToolSurface(claudeCodeHarness, "playwright_mcp")).toBe("playwright_mcp");
    expect(resolveToolSurface(claudeCodeHarness, "chrome_devtools_mcp")).toBe(
      "chrome_devtools_mcp",
    );
    expect(resolveStartupProfile("playwright_mcp", "LOCAL")).toBe("runner_provided_local_cdp");
    expect(resolveStartupProfile("chrome_devtools_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("accepts stagehand_code with SDK-owned startup profiles", () => {
    expect(resolveToolSurface(claudeCodeHarness, "stagehand_code")).toBe("stagehand_code");
    expect(resolveStartupProfile("stagehand_code", "BROWSERBASE")).toBe("tool_create_browserbase");
    expect(resolveStartupProfile("stagehand_code", "LOCAL")).toBe("tool_launch_local");
  });

  it("supports browse_cli and the code surfaces on Codex", () => {
    expect(resolveToolSurface(codexHarness)).toBe("browse_cli");
    expect(resolveToolSurface(codexHarness, "browse_cli")).toBe("browse_cli");
    expect(resolveToolSurface(codexHarness, "stagehand_code")).toBe("stagehand_code");
    expect(resolveToolSurface(codexHarness, "playwright_code")).toBe("playwright_code");
    expect(resolveToolSurface(codexHarness, "cdp_code")).toBe("cdp_code");
    expect(resolveStartupProfile("stagehand_code", "BROWSERBASE")).toBe("tool_create_browserbase");
    expect(resolveStartupProfile("playwright_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(() => resolveToolSurface(codexHarness, "understudy_code")).toThrow(
      /Harness "codex" supports --tool browse_cli, playwright_code, cdp_code, stagehand_code, playwright_mcp, chrome_devtools_mcp, or stagehand_facade; received "understudy_code"/,
    );
    expect(resolveStartupProfile("browse_cli", "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile("browse_cli", "BROWSERBASE")).toBe("tool_create_browserbase");
  });

  it("supports the MCP surfaces on Codex with runner-provided startup profiles", () => {
    expect(resolveToolSurface(codexHarness, "playwright_mcp")).toBe("playwright_mcp");
    expect(resolveToolSurface(codexHarness, "chrome_devtools_mcp")).toBe("chrome_devtools_mcp");
    expect(resolveStartupProfile("playwright_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveStartupProfile("chrome_devtools_mcp", "LOCAL")).toBe("runner_provided_local_cdp");
  });

  it("allows only direct browse commands through Bash", () => {
    expect(isAllowedBrowseCommand("browse -h")).toBe(true);
    expect(isAllowedBrowseCommand("browse open https://example.com")).toBe(true);
    expect(isAllowedBrowseCommand("./browse -h")).toBe(false);
    expect(isAllowedBrowseCommand("npm test")).toBe(false);
    expect(isAllowedBrowseCommand("browse status; rm -rf /")).toBe(false);
    expect(isAllowedBrowseCommand("browse status\ncat ~/.ssh/id_rsa")).toBe(false);
    expect(isAllowedBrowseCommand("browse status\r\ncat ~/.ssh/id_rsa")).toBe(false);
  });

  it("does not auto-allow raw Bash unless unsandboxed local mode is explicit", () => {
    expect(getBrowseCliAllowedTools()).toEqual(["Skill"]);

    process.env.EVAL_CLAUDE_CODE_ALLOW_UNSANDBOXED_LOCAL = "true";
    expect(getBrowseCliAllowedTools()).toEqual(["Skill", "Bash"]);
  });

  it("exposes browse cli metadata for Braintrust rows", () => {
    expect(getBrowseCliToolMetadata()).toMatchObject({
      toolCommand: "browse",
      browseCliVersion: "0.9.5",
      browseCliEntrypoint: expect.stringMatching(/browse[/\\]bin[/\\]run\.js$/u),
    });
  });

  it("installs the browse skill as a project skill", async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "stagehand-evals-skill-test-"));
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
    expect(result).toBe("---\r\nname: browse\r\n---\r\nADDENDUM\n# Body\r\ntext\r\n");
  });

  it("inserts after BOM-prefixed frontmatter", () => {
    const bom = "﻿";
    const markdown = `${bom}---\nname: browse\n---\n# Body\ntext\n`;
    const result = insertAfterFrontmatter(markdown, "ADDENDUM");
    // The BOM is part of the original source bytes preceding the body, so
    // it stays put ahead of the addendum rather than being dropped or
    // relocated by gray-matter's internal (content-only) BOM stripping.
    expect(result).toBe(`${bom}---\nname: browse\n---\nADDENDUM\n# Body\ntext\n`);
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
    expect(result.indexOf("ADDENDUM")).toBeGreaterThan(result.indexOf("still frontmatter"));
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
      path.dirname(getBrowseCliToolMetadata().browseCliEntrypoint),
      "..",
      "skills",
      "browse",
      "SKILL.md",
    );
    const source = await fsp.readFile(sourcePath, "utf8");
    const sourceFrontmatterMatch = source.match(/^[\s\S]*?\n---\n/);
    expect(sourceFrontmatterMatch).not.toBeNull();
    const sourceFrontmatter = sourceFrontmatterMatch![0];

    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "stagehand-evals-skill-fidelity-test-"));
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
      expect(installed.slice(0, sourceFrontmatter.length)).toBe(sourceFrontmatter);
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
      const wait = waitForCdpEvent(connection as never, "session-1", "Page.frameNavigated", 1);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);
      await expect(wait).rejects.toThrow('Timed out waiting for CDP event "Page.frameNavigated"');
      expect(listeners.size).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
