import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  browseSkillDirsForAgent,
  isBrowseSkillInstalled,
} from "../src/lib/skill-presence.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) continue;
    await rm(path, { recursive: true, force: true });
  }
});

async function createTempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "browse-skill-home-"));
  cleanupPaths.push(home);
  return home;
}

async function writeSkill(dir: string): Promise<void> {
  const skillDir = join(dir, "browse");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: browse\n---\n",
    "utf8",
  );
}

describe("browseSkillDirsForAgent", () => {
  it("always includes the universal canonical dir", () => {
    const dirs = browseSkillDirsForAgent("hermes", {}, "/home/u");
    expect(dirs).toContain(join("/home/u", ".agents", "skills"));
  });

  it("adds the claude config dir for claude", () => {
    const dirs = browseSkillDirsForAgent("claude", {}, "/home/u");
    expect(dirs).toContain(join("/home/u", ".claude", "skills"));
  });

  it("honors CODEX_HOME for codex", () => {
    const dirs = browseSkillDirsForAgent(
      "codex",
      { CODEX_HOME: "/custom/codex" },
      "/home/u",
    );
    expect(dirs).toContain(join("/custom/codex", "skills"));
  });
});

describe("isBrowseSkillInstalled", () => {
  it("returns false when the skill is absent", async () => {
    const home = await createTempHome();
    expect(await isBrowseSkillInstalled("codex", {}, home)).toBe(false);
  });

  it("detects the skill in the universal canonical dir", async () => {
    const home = await createTempHome();
    await writeSkill(join(home, ".agents", "skills"));
    expect(await isBrowseSkillInstalled("codex", {}, home)).toBe(true);
  });

  it("detects the skill in the agent-specific dir", async () => {
    const home = await createTempHome();
    await writeSkill(join(home, ".claude", "skills"));
    expect(await isBrowseSkillInstalled("claude", {}, home)).toBe(true);
  });
});
