import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

// Lays out the runtime the way installMcpRuntime does, but with the real
// packages from this checkout instead of an npm download.
async function runtime(): Promise<{ dir: string; entrypoint: string }> {
  const root = await mkdtemp(join(tmpdir(), "browse-mcp-runtime-"));
  temporaryDirs.push(root);
  await copyFile(
    join(cliRoot, "dist/lib/mcp/launcher.js"),
    join(root, "main.mjs"),
  );
  await writeFile(join(root, "current.json"), '{"version":"test"}');
  const dir = join(root, "versions", "test");
  for (const name of [
    "stagehand-middleware",
    "@browserbasehq/stagehand",
    "@modelcontextprotocol/sdk",
  ]) {
    await mkdir(dirname(join(dir, "node_modules", name)), { recursive: true });
    await symlink(
      join(cliRoot, "node_modules", name),
      join(dir, "node_modules", name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  for (const file of ["main.js", "server.js"])
    await copyFile(join(cliRoot, "dist/lib/mcp", file), join(dir, file));
  const { version } = JSON.parse(
    await readFile(
      join(cliRoot, "node_modules/stagehand-middleware/package.json"),
      "utf8",
    ),
  );
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ type: "module", version }),
  );
  return { dir: root, entrypoint: join(root, "main.mjs") };
}

function start(entrypoint: string, args: string[], cwd: string) {
  return spawn(process.execPath, [entrypoint, ...args], {
    cwd,
    env: {
      ...process.env,
      BROWSERBASE_CONFIG_DIR: cwd,
      BROWSERBASE_API_KEY: undefined,
      STAGEHAND_BROWSER: undefined,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

it("rejects conflicting browser flags", async () => {
  const { dir, entrypoint } = await runtime();
  const child = start(entrypoint, ["--local", "--remote"], dir);
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((done) => child.on("close", done));
  expect(code).toBe(2);
  expect(stderr).toContain("--local or --remote");
});

it("serves the middleware tools over clean stdio without browse installed", async () => {
  const { dir, entrypoint } = await runtime();
  await new Promise<void>((resolvePromise, reject) => {
    const child = start(entrypoint, ["--local"], dir);
    let stderr = "";
    let listed = false;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP startup timed out: ${stderr}`));
    }, 15_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const response = JSON.parse(line);
        if (response.id === 1) {
          expect(response.error, stderr).toBeUndefined();
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
          );
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
          );
        }
        if (response.id === 2) {
          expect(
            response.result.tools.map((tool: { name: string }) => tool.name),
          ).toEqual(["run", "snapshot", "screenshot"]);
          listed = true;
          child.stdin.end();
        }
      } catch (error) {
        child.kill();
        reject(error);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0 && listed) resolvePromise();
      else reject(new Error(`MCP exited ${code}: ${stderr}`));
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "browse-test", version: "1" } } })}\n`,
    );
  });
});
