import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  buildV4CodeMcpServerConfig,
  executeV4DeterministicSnippet,
  getBrowseCliAllowedTools,
  getBrowseCliToolMetadata,
  insertAfterFrontmatter,
  isAllowedBrowseCommand,
  installBrowseSkill,
  prepareClaudeCodeToolAdapter,
  resolveClaudeCodeStartupProfile,
  resolveClaudeCodeToolSurface,
  resolveV4CodeStagehandModel,
  waitForCdpEvent,
} from "../../framework/claudeCodeToolAdapter.js";
import {
  resolveCodexStartupProfile,
  resolveCodexToolSurface,
} from "../../framework/codexToolAdapter.js";
import type { CdpEventMessage } from "../../core/tools/cdp_code.js";
import { EvalLogger } from "../../logger.js";

describe("claude code tool adapter resolution", () => {
  afterEach(() => {
    delete process.env.EVAL_CLAUDE_CODE_ALLOW_UNSANDBOXED_LOCAL;
    delete process.env.EVAL_V4_CODE_STAGEHAND_MODEL;
  });

  it("defaults Claude Code to browse_cli", () => {
    expect(resolveClaudeCodeToolSurface()).toBe("browse_cli");
  });

  it("defaults browse_cli startup by environment", () => {
    expect(resolveClaudeCodeStartupProfile("browse_cli", "LOCAL")).toBe("tool_launch_local");
    expect(resolveClaudeCodeStartupProfile("browse_cli", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
  });

  it("supports code tool surfaces as Claude Code run tools", () => {
    expect(resolveClaudeCodeToolSurface("playwright_code")).toBe("playwright_code");
    expect(resolveClaudeCodeStartupProfile("playwright_code", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveClaudeCodeStartupProfile("playwright_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveClaudeCodeToolSurface("cdp_code")).toBe("cdp_code");
    expect(resolveClaudeCodeStartupProfile("cdp_code", "LOCAL")).toBe("runner_provided_local_cdp");
    expect(resolveClaudeCodeStartupProfile("cdp_code", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("supports deterministic V4 only as a local tool-launched surface", () => {
    expect(resolveClaudeCodeToolSurface("v4_code_deterministic")).toBe("v4_code_deterministic");
    expect(resolveClaudeCodeStartupProfile("v4_code_deterministic", "LOCAL")).toBe(
      "tool_launch_local",
    );
    expect(() =>
      resolveClaudeCodeStartupProfile(
        "v4_code_deterministic",
        "LOCAL",
        "runner_provided_local_cdp",
      ),
    ).toThrow(/requires startup profile "tool_launch_local"/);
    expect(() => resolveClaudeCodeStartupProfile("v4_code_deterministic", "BROWSERBASE")).toThrow(
      /supports only the LOCAL environment/,
    );
  });

  it("maps v4_code startup to the shared MCP browser environment", () => {
    expect(resolveClaudeCodeToolSurface("v4_code")).toBe("v4_code");
    expect(resolveClaudeCodeStartupProfile("v4_code", "LOCAL")).toBe("tool_launch_local");
    expect(resolveClaudeCodeStartupProfile("v4_code", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(() =>
      resolveClaudeCodeStartupProfile("v4_code", "LOCAL", "runner_provided_local_cdp"),
    ).toThrow(/requires startup profile "tool_launch_local" in LOCAL/);
    expect(() =>
      resolveClaudeCodeStartupProfile("v4_code", "BROWSERBASE", "tool_launch_local"),
    ).toThrow(/requires startup profile "tool_create_browserbase" in BROWSERBASE/);
  });

  it("configures the shared stdio MCP explicitly for local and Browserbase runs", () => {
    const local = buildV4CodeMcpServerConfig(
      "LOCAL",
      "anthropic/claude-sonnet-5" as AvailableModel,
      {
        PATH: "/test/bin",
        BROWSERBASE_API_KEY: "test-browserbase-key",
        EVAL_V4_CODE_STAGEHAND_MODEL: "groq/openai/gpt-oss-120b",
      },
    );
    const remote = buildV4CodeMcpServerConfig(
      "BROWSERBASE",
      "anthropic/claude-sonnet-5" as AvailableModel,
      {
        PATH: "/test/bin",
        BROWSERBASE_API_KEY: "test-browserbase-key",
      },
    );

    expect(local).toMatchObject({
      type: "stdio",
      command: process.execPath,
      args: [expect.stringMatching(/integrations[/\\]dist[/\\]codemode[/\\]stdio-server\.mjs$/u)],
      alwaysLoad: true,
      env: {
        PATH: "/test/bin",
        BROWSERBASE_API_KEY: "test-browserbase-key",
        STAGEHAND_BROWSER: "local",
        STAGEHAND_MODEL_NAME: "groq/openai/gpt-oss-120b",
      },
    });
    expect(remote).toMatchObject({
      env: {
        STAGEHAND_BROWSER: "browserbase",
        STAGEHAND_MODEL_NAME: "anthropic/claude-sonnet-5",
      },
    });
  });

  it("prepares v4_code as one shared MCP tool without initializing Stagehand in evals", async () => {
    const adapter = await prepareClaudeCodeToolAdapter({
      toolSurface: "v4_code",
      startupProfile: "tool_create_browserbase",
      environment: "BROWSERBASE",
      plan: {
        dataset: "webvoyager",
        taskId: "task-1",
        startUrl: "https://example.com",
        instruction: "Inspect the example page",
      },
      logger: new EvalLogger(false),
      model: "anthropic/claude-sonnet-5" as AvailableModel,
    });

    try {
      expect(adapter.allowedTools).toEqual([
        "Skill",
        "Bash",
        "mcp__stagehand_browser__code_execute",
      ]);
      expect(adapter.settingSources).toEqual(["project"]);
      expect(adapter.mcpServers).toMatchObject({
        stagehand_browser: {
          type: "stdio",
          command: process.execPath,
          alwaysLoad: true,
          env: { STAGEHAND_BROWSER: "browserbase" },
        },
      });
      expect(adapter.promptInstructions).toContain("shared Stagehand code-mode MCP tool");
      expect(adapter.promptInstructions).toContain("project skill named stagehand-v4-code");
      expect(adapter.promptInstructions).toContain("not injected as a startUrl variable");
      await expect(adapter.canUseTool?.("Skill", { skill: "stagehand-v4-code" })).resolves.toEqual({
        behavior: "allow",
        updatedInput: { skill: "stagehand-v4-code" },
      });
      await expect(
        fsp.readFile(path.join(adapter.cwd, ".claude/skills/stagehand-v4-code/SKILL.md"), "utf8"),
      ).resolves.toContain("# Stagehand V4 code-mode syntax");
      await expect(
        fsp.readFile(
          path.join(adapter.cwd, ".claude/skills/stagehand-v4-code/REFERENCE.md"),
          "utf8",
        ),
      ).resolves.toContain("# Stagehand V4 code-mode reference");
    } finally {
      await adapter.cleanup();
    }
  });

  it("allows the Stagehand operation model to differ from the Claude Code model", () => {
    expect(resolveV4CodeStagehandModel("anthropic/claude-sonnet-4-6" as AvailableModel)).toBe(
      "anthropic/claude-sonnet-4-6",
    );

    process.env.EVAL_V4_CODE_STAGEHAND_MODEL = " openai/gpt-4.1-mini ";
    expect(resolveV4CodeStagehandModel("anthropic/claude-sonnet-4-6" as AvailableModel)).toBe(
      "openai/gpt-4.1-mini",
    );
  });

  it("rejects unsupported Claude Code tool surfaces for now", () => {
    expect(() => resolveClaudeCodeToolSurface("understudy_code")).toThrow(
      /supports --tool .*v4_code_deterministic/,
    );
  });

  it("executes deterministic V4 snippets with native page and context bindings", async () => {
    const logger = new EvalLogger(false);
    const page = { marker: "page" };
    const context = { marker: "context" };

    const result = await executeV4DeterministicSnippet({
      code: `
        console.log("binding check");
        return {
          page: page.marker,
          context: context.marker,
          startUrl,
          task,
          stagehandType: typeof stagehand,
          zType: typeof z,
        };
      `,
      page: page as never,
      context: context as never,
      plan: {
        dataset: "webvoyager",
        taskId: "task-1",
        startUrl: "https://example.com",
        instruction: "Inspect the example page",
      },
      logger,
    });

    expect(result).toEqual({
      page: "page",
      context: "context",
      startUrl: "https://example.com",
      task: {
        dataset: "webvoyager",
        id: "task-1",
        startUrl: "https://example.com",
        instruction: "Inspect the example page",
      },
      stagehandType: "undefined",
      zType: "undefined",
    });
    expect(logger.getLogs()).toEqual([
      expect.objectContaining({
        category: "claude_code",
        message: "run console.log: binding check",
      }),
    ]);
  });

  it("supports browse_cli as the first Codex tool surface", () => {
    expect(resolveCodexToolSurface()).toBe("browse_cli");
    expect(resolveCodexToolSurface("browse_cli")).toBe("browse_cli");
    expect(resolveCodexStartupProfile("browse_cli", "LOCAL")).toBe("tool_launch_local");
    expect(resolveCodexStartupProfile("browse_cli", "BROWSERBASE")).toBe("tool_create_browserbase");
    expect(() => resolveCodexToolSurface("playwright_code")).toThrow(
      /Codex harness supports --tool browse_cli/,
    );
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
