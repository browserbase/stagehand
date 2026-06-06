import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { maybeNudgeInstallSkill } from "../src/lib/skill-nudge.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) continue;
    await rm(path, { recursive: true, force: true });
  }
});

async function setup(options: { skillInstalled?: boolean } = {}): Promise<{
  home: string;
  cacheFile: string;
}> {
  const home = await mkdtemp(join(tmpdir(), "browse-nudge-home-"));
  cleanupPaths.push(home);
  if (options.skillInstalled) {
    const skillDir = join(home, ".agents", "skills", "browse");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: browse\n---\n");
  }

  // Detected agent = codex (checked before CLAUDECODE in @vercel/detect-agent),
  // so the test is deterministic even when run inside another agent harness.
  vi.stubEnv("HOME", home);
  vi.stubEnv("CODEX_THREAD_ID", "sess-1");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("CI", "");
  vi.stubEnv("BROWSE_DISABLE_SKILL_NUDGE", "");

  return { home, cacheFile: join(home, "skill-nudge.json") };
}

function stderrSpy() {
  return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

function nudged(spy: ReturnType<typeof stderrSpy>): boolean {
  return spy.mock.calls.some((call) =>
    String(call[0]).includes("browse skills install"),
  );
}

describe("maybeNudgeInstallSkill", () => {
  it("nudges a detected agent that is missing the skill", async () => {
    const { cacheFile } = await setup();
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    expect(nudged(spy)).toBe(true);
  });

  it("does not nudge twice in the same session", async () => {
    const { cacheFile } = await setup();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "open",
    });
    expect(nudged(spy)).toBe(false);
  });

  it("nudges again for a new session id", async () => {
    const { cacheFile } = await setup();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    vi.stubEnv("CODEX_THREAD_ID", "sess-2");
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    expect(nudged(spy)).toBe(true);
  });

  it("does not nudge when the skill is already installed", async () => {
    const { cacheFile } = await setup({ skillInstalled: true });
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    expect(nudged(spy)).toBe(false);
  });

  it("does not nudge on skills subcommands", async () => {
    const { cacheFile } = await setup();
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "skills:install",
    });
    expect(nudged(spy)).toBe(false);
  });

  it("respects BROWSE_DISABLE_SKILL_NUDGE", async () => {
    const { cacheFile } = await setup();
    vi.stubEnv("BROWSE_DISABLE_SKILL_NUDGE", "1");
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    expect(nudged(spy)).toBe(false);
  });
});
