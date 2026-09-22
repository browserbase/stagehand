import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertPublishedCliDependencies, runReleaseCommand } from "./scoped-release.ts";

// A workspace build can pass against unreleased SDK code. Install the actual
// tarball in isolation so its dependency is resolved from the public registry.
const root = process.cwd();
await assertPublishedCliDependencies(root);
const directory = await mkdtemp(path.join(os.tmpdir(), "browse-package-smoke-"));
try {
  runReleaseCommand(
    "pnpm",
    ["--dir", "packages/cli", "pack", "--pack-destination", directory],
    root,
  );
  const tarball = (await readdir(directory)).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack did not produce a tarball");
  await writeFile(
    path.join(directory, "package.json"),
    '{"private":true,"name":"browse-release-smoke"}\n',
  );
  runReleaseCommand(
    "npm",
    [
      "install",
      "--registry=https://registry.npmjs.org",
      "--no-audit",
      "--no-fund",
      path.join(directory, tarball),
    ],
    directory,
  );
  const binary = path.join(directory, "node_modules/browse/bin/run.js");
  const expected = JSON.parse(
    execFileSync("node", ["-p", "JSON.stringify(require('./packages/cli/package.json'))"], {
      cwd: root,
      encoding: "utf8",
    }),
  ).version;
  const actual = execFileSync("node", [binary, "--version"], { cwd: directory, encoding: "utf8" });
  if (!actual.includes(`browse/${expected}`))
    throw new Error(`Unexpected packed CLI version: ${actual}`);
  process.stdout.write(actual);
  runReleaseCommand("node", [binary, "--help"], directory);
  runReleaseCommand("node", [binary, "start", "--help"], directory);
} finally {
  await rm(directory, { recursive: true, force: true });
}
