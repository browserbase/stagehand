import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { maybeNudgeInstallSkill } from "../src/lib/skill-nudge.js";

const cleanupPaths: string[] = [];
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  stderrSpy.mockRestore();
  vi.unstubAllEnvs();

  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) continue;
    await rm(path, { recursive: true, force: true });
  }
});

async function createTempHome(withSkill: boolean): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "browse-nudge-home-"));
  cleanupPaths.push(home);
  if (withSkill) {
    await mkdir(join(home, ".agents", "skills", "browse"), {
      recursive: true,
    });
  }
  return home;
}

function nudgeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    BROWSE_DISABLE_SKILL_NUDGE: "0",
    CI: "0",
    NODE_ENV: "production",
    ...overrides,
  };
}

function stderrText(): string {
  return stderrSpy.mock.calls.map((call) => String(call[0])).join("");
}

describe("maybeNudgeInstallSkill (session start)", () => {
  it("nudges when the skill is absent", async () => {
    const home = await createTempHome(false);
    vi.stubEnv("HOME", home);
    await maybeNudgeInstallSkill(nudgeEnv());
    expect(stderrText()).toContain("browse skills install");
  });

  it("nudges on every call while the skill is absent (one per session start)", async () => {
    const home = await createTempHome(false);
    vi.stubEnv("HOME", home);
    await maybeNudgeInstallSkill(nudgeEnv());
    await maybeNudgeInstallSkill(nudgeEnv());
    const matches = stderrText().match(/browse skills install/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("stays silent when the skill is installed", async () => {
    const home = await createTempHome(true);
    vi.stubEnv("HOME", home);
    await maybeNudgeInstallSkill(nudgeEnv());
    expect(stderrText()).not.toContain("browse skills install");
  });

  it.each([
    ["BROWSE_DISABLE_SKILL_NUDGE", { BROWSE_DISABLE_SKILL_NUDGE: "1" }],
    ["BB_DISABLE_SKILL_NUDGE", { BB_DISABLE_SKILL_NUDGE: "1" }],
    ["CI", { CI: "true" }],
    ["NODE_ENV=test", { NODE_ENV: "test" }],
  ])("stays silent under %s", async (_label, overrides) => {
    const home = await createTempHome(false);
    vi.stubEnv("HOME", home);
    await maybeNudgeInstallSkill(nudgeEnv(overrides));
    expect(stderrText()).not.toContain("browse skills install");
  });
});
