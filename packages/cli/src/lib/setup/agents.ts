import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const agentNames = ["claude", "codex", "cursor", "opencode"] as const;
export type SetupAgent = (typeof agentNames)[number];
export type SetupScope = "global" | "project";

export function agentPaths(agent: SetupAgent, scope: SetupScope) {
  const global = scope === "global";
  const home = homedir();
  switch (agent) {
    case "claude": {
      const dir = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
      return {
        name: "Claude Code",
        detect: dir,
        mcp: global
          ? process.env.CLAUDE_CONFIG_DIR
            ? join(dir, ".claude.json")
            : join(home, ".claude.json")
          : join(process.cwd(), ".mcp.json"),
        skill: join(
          global ? dir : join(process.cwd(), ".claude"),
          "skills",
          "browse",
        ),
      };
    }
    case "codex": {
      const dir = process.env.CODEX_HOME || join(home, ".codex");
      return {
        name: "Codex",
        detect: dir,
        mcp: join(global ? dir : join(process.cwd(), ".codex"), "config.toml"),
        skill: join(
          global ? home : process.cwd(),
          ".agents",
          "skills",
          "browse",
        ),
      };
    }
    case "cursor": {
      const dir = join(global ? home : process.cwd(), ".cursor");
      return {
        name: "Cursor",
        detect: join(home, ".cursor"),
        mcp: join(dir, "mcp.json"),
        skill: join(dir, "skills", "browse"),
      };
    }
    case "opencode": {
      const dir =
        process.env.OPENCODE_CONFIG_DIR ||
        join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
      const project = join(process.cwd(), ".opencode");
      const root = global ? dir : process.cwd();
      const candidates = [
        ...(!global
          ? [join(project, "opencode.jsonc"), join(project, "opencode.json")]
          : []),
        join(root, "opencode.jsonc"),
        join(root, "opencode.json"),
      ];
      return {
        name: "OpenCode v2",
        detect: dir,
        mcp: join(root, "opencode.jsonc"),
        mcpCandidates: candidates,
        skill: join(global ? dir : project, "skills", "browse"),
      };
    }
  }
}

export async function agentMcpPath(agent: SetupAgent, scope: SetupScope) {
  const paths = agentPaths(agent, scope);
  // OpenCode loads JSONC after JSON, and .opencode after root project files.
  for (const path of paths.mcpCandidates ?? [paths.mcp]) {
    try {
      await access(path);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return paths.mcp;
}

export async function detectAgents(): Promise<SetupAgent[]> {
  const detected: SetupAgent[] = [];
  for (const agent of agentNames) {
    try {
      await access(agentPaths(agent, "global").detect);
      detected.push(agent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return detected;
}

export async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
