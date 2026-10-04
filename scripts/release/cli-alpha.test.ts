import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepareCliAlpha } from "./cli-alpha.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture(pendingChangesets = false) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "browse-alpha-"));
  cleanup.push(() => rm(repositoryRoot, { recursive: true, force: true }));
  await mkdir(path.join(repositoryRoot, "packages/cli"), { recursive: true });
  await mkdir(path.join(repositoryRoot, "packages/sdk"), { recursive: true });
  const manifestPath = path.join(repositoryRoot, "packages/cli/package.json");
  const originalManifest = {
    name: "browse",
    version: "0.11.1",
    dependencies: { sdk: "workspace:*" },
  };
  await writeFile(manifestPath, `${JSON.stringify(originalManifest, null, 2)}\n`);
  const sdkManifestPath = path.join(repositoryRoot, "packages/sdk/package.json");
  await writeFile(sdkManifestPath, '{"name":"sdk","version":"4.1.0"}\n');
  await writeFile(path.join(repositoryRoot, "packages/cli/index.ts"), "export const value = 1;\n");
  if (pendingChangesets) {
    await mkdir(path.join(repositoryRoot, ".changeset"));
    await writeFile(
      path.join(repositoryRoot, ".changeset/browse.md"),
      '---\n"browse": minor\n---\nPending Browse feature\n',
    );
    await writeFile(
      path.join(repositoryRoot, ".changeset/sdk.md"),
      '---\n"sdk": patch\n---\nPending SDK fix\n',
    );
  }
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "test@example.com");
  const initialCommit = commit("Initial packages");

  const registryState = { status: 404, requests: [] as string[] };
  const server = createServer((request, response) => {
    registryState.requests.push(request.url ?? "");
    response.writeHead(registryState.status).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing registry address");
  return {
    repositoryRoot,
    manifestPath,
    originalManifest,
    sdkManifestPath,
    git,
    commit,
    initialCommit,
    registry: `http://127.0.0.1:${address.port}`,
    registryState,
    changeCli: async () => {
      await writeFile(
        path.join(repositoryRoot, "packages/cli/index.ts"),
        "export const value = 2;\n",
      );
      return commit("Change Browse implementation");
    },
  };
}

it("prepares a commit-addressed Browse alpha without requiring a changeset", async () => {
  const { repositoryRoot, manifestPath, originalManifest, changeCli, registry, registryState } =
    await fixture();
  const head = await changeCli();
  const version = `0.11.1-alpha-${head}`;

  expect(await prepareCliAlpha(repositoryRoot, "HEAD^", registry)).toBe(version);
  expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual({
    ...originalManifest,
    version,
  });
  expect(registryState.requests).toEqual([`/browse/${version}`]);
});

it("preserves pending release notes, SDK versions, and workspace dependencies", async () => {
  const { repositoryRoot, manifestPath, sdkManifestPath, changeCli, registry, git } =
    await fixture(true);
  const protectedPaths = [
    sdkManifestPath,
    path.join(repositoryRoot, ".changeset/browse.md"),
    path.join(repositoryRoot, ".changeset/sdk.md"),
  ];
  const before = await Promise.all(protectedPaths.map((file) => readFile(file, "utf8")));
  const head = await changeCli();

  expect(await prepareCliAlpha(repositoryRoot, "HEAD^", registry)).toBe(`0.11.1-alpha-${head}`);
  expect(await Promise.all(protectedPaths.map((file) => readFile(file, "utf8")))).toEqual(before);
  expect(JSON.parse(await readFile(manifestPath, "utf8")).dependencies).toEqual({
    sdk: "workspace:*",
  });
  expect(git("diff", "--name-only")).toBe("packages/cli/package.json");
  expect(git("tag", "--list")).toBe("");
});

it("skips an unrelated push without changing files or querying npm", async () => {
  const { repositoryRoot, commit, git, registry, registryState } = await fixture();
  await writeFile(path.join(repositoryRoot, "README.md"), "SDK documentation\n");
  commit("Update documentation");

  expect(await prepareCliAlpha(repositoryRoot, "HEAD^", registry)).toBeUndefined();
  expect(registryState.requests).toEqual([]);
  expect(git("status", "--porcelain")).toBe("");
});

it("leaves a Browse version-bump push to the stable release publisher", async () => {
  const { repositoryRoot, manifestPath, originalManifest, commit, git, registry, registryState } =
    await fixture();
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...originalManifest, version: "0.12.0" }, null, 2)}\n`,
  );
  commit("Release browse@0.12.0");

  expect(await prepareCliAlpha(repositoryRoot, "HEAD^", registry)).toBeUndefined();
  expect(registryState.requests).toEqual([]);
  expect(JSON.parse(await readFile(manifestPath, "utf8")).version).toBe("0.12.0");
  expect(git("status", "--porcelain")).toBe("");
});

it("checks the whole push range when an earlier commit changed Browse", async () => {
  const { repositoryRoot, initialCommit, changeCli, commit, registry, registryState } =
    await fixture();
  await changeCli();
  await writeFile(path.join(repositoryRoot, "README.md"), "Later documentation change\n");
  const head = commit("Update documentation after Browse change");

  expect(await prepareCliAlpha(repositoryRoot, "HEAD^", registry)).toBeUndefined();
  const version = `0.11.1-alpha-${head}`;
  expect(await prepareCliAlpha(repositoryRoot, initialCommit, registry)).toBe(version);
  expect(registryState.requests).toEqual([`/browse/${version}`]);
});

it("skips an already-published alpha without leaving a modified manifest", async () => {
  const { repositoryRoot, changeCli, git, registry, registryState } = await fixture();
  const head = await changeCli();
  registryState.status = 200;

  expect(await prepareCliAlpha(repositoryRoot, "HEAD^", registry)).toBeUndefined();
  expect(registryState.requests).toEqual([`/browse/0.11.1-alpha-${head}`]);
  expect(git("status", "--porcelain")).toBe("");
});

it("fails on a registry outage instead of treating the alpha as unpublished", async () => {
  const { repositoryRoot, changeCli, git, registry, registryState } = await fixture();
  const head = await changeCli();
  registryState.status = 503;

  await expect(prepareCliAlpha(repositoryRoot, "HEAD^", registry)).rejects.toThrow("503");
  expect(registryState.requests).toEqual([`/browse/0.11.1-alpha-${head}`]);
  expect(git("status", "--porcelain")).toBe("");
});
