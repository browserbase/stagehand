import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  isCompatible,
  MCP_SDK_PACKAGE,
  MCP_SDK_RANGE,
  MIDDLEWARE_PACKAGE,
  MIDDLEWARE_RANGE,
  type PackageManifest,
} from "./contract.js";

const execFileAsync = promisify(execFile);

export interface McpRuntime {
  entrypoint: string;
  version: string;
}

// User data rather than a cache: agents launch this path directly, so it must
// not disappear when caches are cleared.
export function mcpRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    "browserbase",
    "stagehand-mcp",
  );
}

export function mcpEntrypoint(env: NodeJS.ProcessEnv = process.env): string {
  return join(mcpRuntimeDir(env), "main.mjs");
}

function adapterDir(): string {
  return fileURLToPath(new URL("../../../dist/lib/mcp/", import.meta.url));
}

async function npmCommand(): Promise<{ file: string; args: string[] }> {
  if (process.platform !== "win32") return { file: "npm", args: [] };
  // Execute npm's JS entrypoint directly; .cmd files require a shell on Windows.
  for (const directory of [
    dirname(process.execPath),
    ...(process.env.PATH ?? "").split(delimiter),
  ]) {
    const cli = join(directory, "node_modules", "npm", "bin", "npm-cli.js");
    try {
      await access(cli);
      return { file: process.execPath, args: [cli] };
    } catch {
      continue;
    }
  }
  throw new Error("npm was not found on PATH.");
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(join(path, "package.json"), "utf8"));
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, path);
}

async function currentVersion(root: string): Promise<string | undefined> {
  try {
    return (
      JSON.parse(await readFile(join(root, "current.json"), "utf8")) as {
        version?: string;
      }
    ).version;
  } catch {
    return undefined;
  }
}

/**
 * Installs the newest compatible Stagehand MCP runtime into a new version
 * directory, then switches the stable launcher to it. Agents keep launching
 * the same entrypoint, so rerunning setup is how users update.
 */
export async function installMcpRuntime(
  nodeVersion: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<McpRuntime> {
  const root = mcpRuntimeDir(env);
  const versions = join(root, "versions");
  await mkdir(versions, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(versions, ".install-"));
  try {
    await writeFile(
      join(staging, "package.json"),
      '{"private":true,"type":"module"}\n',
    );
    const npm = await npmCommand();
    try {
      await execFileAsync(
        npm.file,
        [
          ...npm.args,
          "install",
          `${MIDDLEWARE_PACKAGE}@${MIDDLEWARE_RANGE}`,
          `${MCP_SDK_PACKAGE}@${MCP_SDK_RANGE}`,
          "--prefix",
          staging,
          "--registry=https://registry.npmjs.org",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          "--loglevel=error",
        ],
        {
          cwd: staging,
          env,
          timeout: 180_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        },
      );
    } catch (error) {
      const detail = String((error as { stderr?: unknown }).stderr ?? "")
        .trim()
        .slice(-1000);
      throw new Error(
        `Could not install Stagehand MCP with npm${detail ? `: ${detail}` : "."}`,
        { cause: error },
      );
    }
    const modules = join(staging, "node_modules");
    const middleware = await readManifest(join(modules, MIDDLEWARE_PACKAGE));
    const sdk = await readManifest(
      join(modules, "@browserbasehq", "stagehand"),
    );
    if (!isCompatible(middleware, sdk.version, nodeVersion))
      throw new Error(
        `${MIDDLEWARE_PACKAGE}@${middleware.version} is incompatible with @browserbasehq/stagehand@${sdk.version} or Node ${nodeVersion}.`,
      );
    for (const file of ["main.js", "server.js"])
      await copyFile(join(adapterDir(), file), join(staging, file));
    const manifest = JSON.parse(
      await readFile(join(staging, "package.json"), "utf8"),
    );
    await writeFile(
      join(staging, "package.json"),
      `${JSON.stringify({ ...manifest, name: "stagehand-mcp", version: middleware.version }, null, 2)}\n`,
    );

    // A fresh directory name never collides, so publishing it is one rename.
    const id = `${middleware.version}-${basename(staging).replace(".install-", "")}`;
    await rename(staging, join(versions, id));
    const previous = await currentVersion(root);
    await writeAtomically(
      mcpEntrypoint(env),
      await readFile(join(adapterDir(), "launcher.js"), "utf8"),
    );
    await writeAtomically(
      join(root, "current.json"),
      `${JSON.stringify({ version: id })}\n`,
    );
    // Keep the replaced version for agents that are still running it.
    for (const entry of await readdir(versions)) {
      if (entry !== id && entry !== previous && !entry.startsWith("."))
        await rm(join(versions, entry), { recursive: true, force: true }).catch(
          () => {},
        );
    }
    return { entrypoint: mcpEntrypoint(env), version: middleware.version };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
