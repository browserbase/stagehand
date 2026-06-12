import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    await mkdir(join(home, ".agents", "skills", "browse"), {
      recursive: true,
    });
  }

  // os.homedir() honors $HOME, so the canonical-path check stays inside the
  // temp dir even when the suite runs on a machine with the skill installed.
  vi.stubEnv("HOME", home);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("CI", "");
  vi.stubEnv("BROWSE_DISABLE_SKILL_NUDGE", "");

  return { home, cacheFile: join(home, "cache", "skill-nudge.json") };
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
  it("nudges once when the canonical skill dir is absent and writes the marker", async () => {
    const { cacheFile } = await setup();
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    expect(nudged(spy)).toBe(true);
    await expect(access(cacheFile)).resolves.toBeUndefined();
  });

  it("stays silent on the next run once the marker exists", async () => {
    const { cacheFile } = await setup();
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    expect(nudged(spy)).toBe(true);
    spy.mockClear();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "open",
    });
    expect(nudged(spy)).toBe(false);
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

  it("does not nudge on skills subcommands, help, or a missing commandId", async () => {
    const { cacheFile } = await setup();
    const spy = stderrSpy();
    for (const commandId of ["skills:install", "skills", "help", undefined]) {
      await maybeNudgeInstallSkill(process.env, { cacheFile, commandId });
    }
    expect(nudged(spy)).toBe(false);
  });

  it("respects env opt-outs and CI", async () => {
    const { cacheFile } = await setup();
    const spy = stderrSpy();
    for (const overrides of [
      { BROWSE_DISABLE_SKILL_NUDGE: "1" },
      { BB_DISABLE_SKILL_NUDGE: "1" },
      { NODE_ENV: "test" },
      { CI: "true" },
    ]) {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "development",
        CI: "",
        ...overrides,
      };
      await maybeNudgeInstallSkill(env, { cacheFile, commandId: "status" });
    }
    expect(nudged(spy)).toBe(false);
  });

  it("does not nudge when the marker cannot be written", async () => {
    const { home } = await setup();
    // Parent "directory" is a regular file, so mkdir/writeFile must fail.
    const blocker = join(home, "blocked");
    await writeFile(blocker, "not a directory\n", "utf8");
    const cacheFile = join(blocker, "skill-nudge.json");
    const spy = stderrSpy();
    await maybeNudgeInstallSkill(process.env, {
      cacheFile,
      commandId: "status",
    });
    expect(nudged(spy)).toBe(false);
  });
});
