import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import semver from "semver";

import { NODE_RANGE } from "../mcp/contract.js";
import { bundledCliSkillPath } from "../skills/install.js";
import {
  agentPaths,
  agentMcpPath,
  readOptionalFile,
  type SetupAgent,
  type SetupScope,
} from "./agents.js";
import type { BrowserMode } from "./config.js";
import { updateJsonMcp, updateOpenCodeMcp, updateTomlMcp } from "./mcp.js";

const execFileAsync = promisify(execFile);

export type SetupMode = "cli" | "mcp" | "both";

export interface SetupOptions {
  agents: SetupAgent[];
  scope: SetupScope;
  mode: SetupMode;
  browser: BrowserMode;
  /** How agents launch Stagehand MCP; required unless mode is "cli". */
  mcp?: { node: string; entrypoint: string };
}

export interface NodeRuntime {
  path: string;
  version: string;
}

interface SetupProcess {
  bun: boolean;
  execPath: string;
  version: string;
  PATH: string;
}

const currentProcess: SetupProcess = {
  bun: Boolean(process.versions.bun),
  execPath: process.execPath,
  version: process.version,
  PATH: process.env.PATH ?? "",
};

/** Finds the Node that will run Stagehand MCP and checks its version. */
export async function nodeExecutable(
  setup: SetupProcess = currentProcess,
): Promise<NodeRuntime> {
  const unsupported = (found: string) =>
    new Error(
      `Stagehand MCP needs Node.js ${NODE_RANGE}${found}. Install it from https://nodejs.org and rerun setup.`,
    );
  // `bunx browse setup` may run under Bun, but the MCP runtime needs Node.
  if (!setup.bun) {
    if (!semver.satisfies(setup.version, NODE_RANGE))
      throw unsupported(`; found ${setup.version}`);
    return { path: setup.execPath, version: setup.version };
  }
  const found: string[] = [];
  const name = process.platform === "win32" ? "node.exe" : "node";
  for (const directory of setup.PATH.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      const { stdout } = await execFileAsync(
        candidate,
        ["-p", "process.version"],
        { timeout: 10_000, windowsHide: true },
      );
      const version = stdout.trim();
      if (semver.satisfies(version, NODE_RANGE))
        return { path: candidate, version };
      found.push(`${version} at ${candidate}`);
    } catch {
      continue;
    }
  }
  throw unsupported(found.length ? `; found ${found.join(", ")}` : "");
}

export interface SetupFile {
  path: string;
  contents: string;
}

/** Builds every file setup will write, failing on malformed client configs. */
export async function prepareSetup(
  options: SetupOptions,
): Promise<SetupFile[]> {
  const files: SetupFile[] = [];
  const entry =
    options.mode === "cli"
      ? undefined
      : {
          command: options.mcp!.node,
          args: [
            options.mcp!.entrypoint,
            options.browser === "local" ? "--local" : "--remote",
          ],
        };
  for (const agent of options.agents) {
    const paths = agentPaths(agent, options.scope);
    if (options.mode !== "mcp") {
      files.push({
        path: join(paths.skill, "SKILL.md"),
        contents: await readFile(
          join(bundledCliSkillPath(), "SKILL.md"),
          "utf8",
        ),
      });
    }
    if (entry) {
      const path = await agentMcpPath(agent, options.scope);
      const raw = await readOptionalFile(path);
      files.push({
        path,
        contents:
          agent === "codex"
            ? updateTomlMcp(raw, entry)
            : agent === "opencode"
              ? updateOpenCodeMcp(raw, entry)
              : updateJsonMcp(raw, entry, agent === "claude"),
      });
    }
  }
  return files;
}

export async function writeSetup(files: SetupFile[]): Promise<string[]> {
  for (const file of files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents, { mode: 0o600 });
  }
  return files.map((file) => file.path);
}
