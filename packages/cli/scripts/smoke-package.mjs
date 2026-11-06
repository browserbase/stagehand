import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import spawn from "cross-spawn";

// Build first: pnpm exec turbo run build --filter=browse
// Keep the install outside the workspace so undeclared dependencies cannot leak in.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "browse installed smoke-"));
const env = {
  ...process.env,
  NODE_PATH: undefined,
  BROWSE_DISABLE_UPDATE_CHECK: "1",
  BROWSE_LOAD_DOTENV: "0",
  DO_NOT_TRACK: "1",
};

try {
  const tarball = join(directory, "browse.tgz");
  run("pnpm", ["pack", "--out", tarball], packageRoot);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "browse-installed-smoke", private: true }),
  );
  // Like the release smoke, resolve the SDK from npm, not a workspace link.
  run("npm", [
    "install",
    "--registry=https://registry.npmjs.org",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    tarball,
  ]);

  const executable = join(
    directory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "browse.cmd" : "browse",
  );
  const expected = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const version = run(executable, ["--version"], directory, true);
  assert.ok(version.includes(`browse/${expected.version}`), `Unexpected CLI version: ${version}`);
  run(executable, ["--help"]);
  run(executable, ["open", "--help"]);

  env.BROWSE_SMOKE_BIN = executable;
  run(
    process.execPath,
    [
      join(packageRoot, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.smoke.config.ts",
    ],
    packageRoot,
  );
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
}

function run(command, args, cwd = directory, capture = false) {
  console.log(`Running ${command} ${args.join(" ")}`);
  const result = spawn.sync(command, args, {
    cwd,
    env,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
    timeout: 300_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with ${result.status} (${result.signal ?? "no signal"})\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout ?? "";
}
