import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StagehandMetrics } from "@browserbasehq/stagehand";
import { afterEach, describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  buildV4StagehandMetrics,
  collectV4StagehandMetrics,
  executeV4AiSnippet,
  executeV4DeterministicSnippet,
  getBrowseCliAllowedTools,
  getBrowseCliToolMetadata,
  insertAfterFrontmatter,
  isAllowedBrowseCommand,
  installBrowseSkill,
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

const zeroStagehandMetrics: StagehandMetrics = {
  actPromptTokens: 0,
  actCompletionTokens: 0,
  actReasoningTokens: 0,
  actCachedInputTokens: 0,
  actInferenceTimeMs: 0,
  extractPromptTokens: 0,
  extractCompletionTokens: 0,
  extractReasoningTokens: 0,
  extractCachedInputTokens: 0,
  extractInferenceTimeMs: 0,
  observePromptTokens: 0,
  observeCompletionTokens: 0,
  observeReasoningTokens: 0,
  observeCachedInputTokens: 0,
  observeInferenceTimeMs: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalReasoningTokens: 0,
  totalCachedInputTokens: 0,
  totalInferenceTimeMs: 0,
};

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

  it("uses tool-owned startup profiles for deterministic V4", () => {
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
    expect(resolveClaudeCodeStartupProfile("v4_code_deterministic", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(() =>
      resolveClaudeCodeStartupProfile(
        "v4_code_deterministic",
        "BROWSERBASE",
        "runner_provided_browserbase_cdp",
      ),
    ).toThrow(/requires startup profile "tool_create_browserbase"/);
  });

  it("uses tool-owned startup profiles for AI-enabled V4", () => {
    expect(resolveClaudeCodeToolSurface("v4_code")).toBe("v4_code");
    expect(resolveClaudeCodeStartupProfile("v4_code", "LOCAL")).toBe("tool_launch_local");
    expect(() =>
      resolveClaudeCodeStartupProfile("v4_code", "LOCAL", "runner_provided_local_cdp"),
    ).toThrow(/requires startup profile "tool_launch_local"/);
    expect(resolveClaudeCodeStartupProfile("v4_code", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
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

  it("adds native Stagehand and Zod bindings only for the AI-enabled V4 surface", async () => {
    const logger = new EvalLogger(false);
    const stagehand = {
      act: async (instruction: string) => ({ instruction, success: true }),
    };

    const result = await executeV4AiSnippet({
      code: `
        const schema = z.object({ heading: z.string() });
        return {
          action: await stagehand.act("click the link"),
          parsed: schema.parse({ heading: "Example Domain" }),
        };
      `,
      stagehand: stagehand as never,
      page: {} as never,
      context: {} as never,
      plan: {
        dataset: "webvoyager",
        startUrl: "https://example.com",
        instruction: "Inspect the example page",
      },
      logger,
    });

    expect(result).toEqual({
      action: { instruction: "click the link", success: true },
      parsed: { heading: "Example Domain" },
    });
  });

  it("maps Stagehand metrics into prefixed eval metrics", () => {
    const metrics = buildV4StagehandMetrics({
      ...zeroStagehandMetrics,
      actPromptTokens: 12,
      totalInferenceTimeMs: 340,
    });

    expect(metrics).toMatchObject({
      v4_stagehand_metrics_available: { count: 1, value: 1 },
      v4_act_prompt_tokens: { count: 1, value: 12 },
      v4_total_inference_time_ms: { count: 1, value: 340 },
    });
    expect(Object.keys(metrics)).toHaveLength(21);
  });

  it("collects the deterministic zero snapshot as available metrics", async () => {
    const metrics = async () => zeroStagehandMetrics;

    const collected = await collectV4StagehandMetrics({ metrics });

    expect(collected).toMatchObject({
      v4_stagehand_metrics_available: { count: 1, value: 1 },
      v4_act_prompt_tokens: { count: 1, value: 0 },
      v4_total_inference_time_ms: { count: 1, value: 0 },
    });
    expect(Object.keys(collected)).toHaveLength(21);
  });

  it("does not hide unexpected Stagehand metrics failures", async () => {
    const metrics = async () => {
      throw new Error("metrics transport failed");
    };

    await expect(collectV4StagehandMetrics({ metrics })).rejects.toThrow(
      "metrics transport failed",
    );
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
