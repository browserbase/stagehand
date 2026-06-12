import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Check the single canonical install location for the browse skill:
 * `~/.agents/skills/browse`. This is the directory `browse skills install`
 * itself writes (via `npx skills add --global --agent '*'`) and the path
 * `skills ls` prints — agent-specific dirs are just symlinks into it, so one
 * filesystem check covers every agent.
 */
export async function isBrowseSkillInstalled(
  home: string = homedir(),
): Promise<boolean> {
  try {
    await access(join(home, ".agents", "skills", "browse"));
    return true;
  } catch {
    return false;
  }
}
