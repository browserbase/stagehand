import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Check the canonical install locations for the bundled browse skill, matching
 * the `skills` CLI's own two scopes (its source resolves
 * `join(global ? homedir() : cwd, ".agents", "skills")`):
 *
 *   - global:  `~/.agents/skills/browse` — what `browse skills install`
 *     itself writes (`npx skills add --global --agent '*'`)
 *   - project: `<cwd>/.agents/skills/browse` — `skills add` without `-g`
 *
 * Agent-specific dirs are symlinks/copies alongside the canonical dir, so two
 * filesystem checks cover every agent at both scopes.
 */
export async function isBrowseSkillInstalled(
  home: string = homedir(),
  cwd: string = process.cwd(),
): Promise<boolean> {
  const candidates = [
    join(home, ".agents", "skills", "browse"),
    join(cwd, ".agents", "skills", "browse"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return true;
    } catch {
      // Keep checking the remaining scopes.
    }
  }

  return false;
}
