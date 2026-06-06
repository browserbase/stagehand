import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const BROWSE_SKILL_FOLDER = "browse";

/**
 * Candidate skills directories where `browse skills install`
 * (`npx skills add ... --global --agent *`) may have written the browse skill
 * for a given agent. The canonical copy always lands in `~/.agents/skills`;
 * agents with bespoke skill dirs also get a symlink there.
 */
export function browseSkillDirsForAgent(
  agentName: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string[] {
  const dirs = new Set<string>();

  // Universal canonical location shared by most agents.
  dirs.add(join(home, ".agents", "skills"));

  switch (agentName) {
    case "claude":
    case "cowork":
      dirs.add(join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "skills"));
      break;
    case "codex":
      dirs.add(join(env.CODEX_HOME ?? join(home, ".codex"), "skills"));
      break;
    case "cursor":
    case "cursor-cli":
      dirs.add(join(home, ".cursor", "skills"));
      break;
    case "gemini":
      dirs.add(join(home, ".gemini", "skills"));
      break;
    case "github-copilot":
      dirs.add(join(home, ".copilot", "skills"));
      break;
    default:
      // Universal-only agents (hermes, openclaw, opencode, …) share
      // `~/.agents/skills`, already added above.
      break;
  }

  return [...dirs];
}

/**
 * Best-effort check for whether the bundled browse skill is present on disk in
 * any of the calling agent's skills directories. This detects an installed
 * skill *file*; it cannot know whether the agent has loaded it into context.
 */
export async function isBrowseSkillInstalled(
  agentName: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<boolean> {
  for (const dir of browseSkillDirsForAgent(agentName, env, home)) {
    try {
      await access(join(dir, BROWSE_SKILL_FOLDER, "SKILL.md"), constants.F_OK);
      return true;
    } catch {
      // Not present in this directory; keep checking.
    }
  }

  return false;
}
