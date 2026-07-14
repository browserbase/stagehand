import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isBareLoopHarness,
  isExternalHarness,
  parseBenchHarness,
  parseSkillDeliveryMode,
} from "../../framework/benchTypes.js";
import {
  BARE_LOOP_DEFAULT_SYSTEM_PROMPT,
  resolveExternalHarnessStartupProfile,
  runBareBrowseCommand,
  tokenizeBrowseArgs,
} from "../../framework/externalHarnessToolAdapter.js";

describe("harness classification", () => {
  it("registers the four new harnesses as parseable", () => {
    expect(parseBenchHarness("vercel_ai_sdk")).toBe("vercel_ai_sdk");
    expect(parseBenchHarness("anthropic_sdk")).toBe("anthropic_sdk");
    expect(parseBenchHarness("openai_agents_sdk")).toBe("openai_agents_sdk");
    expect(parseBenchHarness("cursor_sdk")).toBe("cursor_sdk");
  });

  it("classifies bare loops vs full harnesses", () => {
    expect(isBareLoopHarness("vercel_ai_sdk")).toBe(true);
    expect(isBareLoopHarness("anthropic_sdk")).toBe(true);
    expect(isBareLoopHarness("openai_agents_sdk")).toBe(true);
    // Cursor is a FULL harness (same runtime/harness that powers Cursor) —
    // it sits on the smart tier next to claude_code/codex, not the bare tier.
    expect(isBareLoopHarness("cursor_sdk")).toBe(false);
    expect(isBareLoopHarness("claude_code")).toBe(false);
    expect(isBareLoopHarness("stagehand")).toBe(false);
  });

  it("classifies external harnesses", () => {
    for (const harness of [
      "claude_code",
      "codex",
      "vercel_ai_sdk",
      "anthropic_sdk",
      "openai_agents_sdk",
      "cursor_sdk",
    ] as const) {
      expect(isExternalHarness(harness)).toBe(true);
    }
    expect(isExternalHarness("stagehand")).toBe(false);
  });
});

describe("skill delivery mode", () => {
  it("defaults to none and parses the three modes", () => {
    expect(parseSkillDeliveryMode(undefined)).toBe("none");
    expect(parseSkillDeliveryMode("none")).toBe("none");
    expect(parseSkillDeliveryMode("prompt_show")).toBe("prompt_show");
    expect(parseSkillDeliveryMode("injected")).toBe("injected");
  });

  it("rejects unknown modes loudly", () => {
    expect(() => parseSkillDeliveryMode("skill")).toThrow(/Unknown skill mode/);
  });
});

describe("bare-loop system prompt policy", () => {
  it("mirrors the sandbox-template one-liner exactly (no extra scaffolding)", () => {
    expect(BARE_LOOP_DEFAULT_SYSTEM_PROMPT).toContain(
      'You drive a real web browser by running the "browse" CLI',
    );
    expect(BARE_LOOP_DEFAULT_SYSTEM_PROMPT).toContain(
      "You have not used this CLI before and have no documentation for it beyond what you discover yourself.",
    );
    expect(BARE_LOOP_DEFAULT_SYSTEM_PROMPT).toContain(
      'running "--help" and "<command> --help" as needed',
    );
    // The bareness is the instrument: no retry advice, no cheat-sheets.
    expect(BARE_LOOP_DEFAULT_SYSTEM_PROMPT).not.toMatch(/retry|persist/i);
  });
});

describe("startup profile resolution", () => {
  it("defaults by environment and honors explicit requests", () => {
    expect(resolveExternalHarnessStartupProfile("LOCAL")).toBe(
      "tool_launch_local",
    );
    expect(resolveExternalHarnessStartupProfile("BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(
      resolveExternalHarnessStartupProfile("LOCAL", "tool_create_browserbase"),
    ).toBe("tool_create_browserbase");
  });
});

describe("tokenizeBrowseArgs", () => {
  it("splits plain args on whitespace", () => {
    expect(tokenizeBrowseArgs("open https://example.com --wait load")).toEqual([
      "open",
      "https://example.com",
      "--wait",
      "load",
    ]);
  });

  it("keeps quoted segments together", () => {
    expect(tokenizeBrowseArgs('fill input[name="q"] "hello world"')).toEqual([
      "fill",
      'input[name="q"]',
      "hello world",
    ]);
    expect(tokenizeBrowseArgs("type 'a b c'")).toEqual(["type", "a b c"]);
  });
});

describe("runBareBrowseCommand", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function makeFakeAdapter(script: string): Promise<{
    browseBinPath: string;
    cwd: string;
    env: Record<string, string>;
  }> {
    tempDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "stagehand-evals-bareloop-test-"),
    );
    const bin = path.join(tempDir, "browse");
    await fsp.writeFile(bin, `#!/usr/bin/env bash\n${script}\n`, {
      mode: 0o755,
    });
    return {
      browseBinPath: bin,
      cwd: tempDir,
      env: { ...process.env, PATH: `${tempDir}:${process.env.PATH}` } as Record<
        string,
        string
      >,
    };
  }

  it("executes a single allowed browse command and returns stdout", async () => {
    const adapter = await makeFakeAdapter('echo "args:$@"');
    const result = await runBareBrowseCommand(
      adapter,
      "open https://example.com",
      "none",
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe("args:open https://example.com");
  });

  it("rejects shell metacharacters without spawning anything", async () => {
    const adapter = await makeFakeAdapter("echo should-not-run");
    for (const args of [
      "open https://example.com; rm -rf /",
      "open https://example.com | cat",
      "open $(whoami)",
      "open https://example.com > /tmp/out",
    ]) {
      const result = await runBareBrowseCommand(adapter, args, "none");
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/Rejected/);
    }
  });

  it("captures failures as tool errors instead of throwing", async () => {
    const adapter = await makeFakeAdapter('echo "boom" >&2; exit 3');
    const result = await runBareBrowseCommand(
      adapter,
      "open https://x.test",
      "none",
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain("boom");
  });

  it('rejects "skills" commands under skillMode=none without spawning anything', async () => {
    const adapter = await makeFakeAdapter("echo should-not-run");
    const result = await runBareBrowseCommand(adapter, "skills show", "none");
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Rejected.*skillMode=none/);
  });

  it('allows "skills show" under skillMode=prompt_show and appends the eval-harness addendum', async () => {
    const adapter = await makeFakeAdapter('echo "raw skill content"');
    const result = await runBareBrowseCommand(
      adapter,
      "skills show",
      "prompt_show",
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("raw skill content");
    expect(result.output).toContain("Eval Harness Addendum");
  });

  it('does not append the addendum to "skills show" under skillMode=injected', async () => {
    const adapter = await makeFakeAdapter('echo "raw skill content"');
    const result = await runBareBrowseCommand(
      adapter,
      "skills show",
      "injected",
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe("raw skill content");
  });
});
