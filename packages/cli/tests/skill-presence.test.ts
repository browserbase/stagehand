import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isBrowseSkillInstalled } from "../src/lib/skill-presence.js";

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

describe("isBrowseSkillInstalled", () => {
  it("returns false when both canonical scopes are absent", async () => {
    const home = await createTempHome();
    const project = await createTempHome();
    expect(await isBrowseSkillInstalled(home, project)).toBe(false);
  });

  it("returns true when the global ~/.agents/skills/browse exists", async () => {
    const home = await createTempHome();
    const project = await createTempHome();
    await mkdir(join(home, ".agents", "skills", "browse"), {
      recursive: true,
    });
    expect(await isBrowseSkillInstalled(home, project)).toBe(true);
  });

  it("returns true for a project-scoped <cwd>/.agents/skills/browse", async () => {
    const home = await createTempHome();
    const project = await createTempHome();
    await mkdir(join(project, ".agents", "skills", "browse"), {
      recursive: true,
    });
    expect(await isBrowseSkillInstalled(home, project)).toBe(true);
  });
});
