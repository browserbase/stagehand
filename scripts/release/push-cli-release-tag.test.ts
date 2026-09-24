import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { pushCliReleaseTag } from "./push-cli-release-tag.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "browse-tag-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const repositoryRoot = path.join(directory, "checkout");
  await mkdir(path.join(repositoryRoot, "packages/cli"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "test@example.com");
  git("init", "--bare", path.join(directory, "remote.git"));
  git("remote", "add", "origin", path.join(directory, "remote.git"));
  for (const version of ["0.9.6", "0.10.0"]) {
    await writeFile(
      path.join(repositoryRoot, "packages/cli/package.json"),
      JSON.stringify({ name: "browse", version }),
    );
    git("add", ".");
    git("commit", "-m", `Version ${version}`);
  }
  const releaseCommit = git("rev-parse", "HEAD");
  const registryState = { status: 200, requests: 0 };
  const server = createServer((request, response) => {
    registryState.requests++;
    response.writeHead(request.url === "/browse/0.10.0" ? registryState.status : 404).end("{}");
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
    git,
    releaseCommit,
    registry: `http://127.0.0.1:${address.port}`,
    registryState,
  };
}

it("recovers after npm accepted the version but the publisher did not create a tag", async () => {
  const { repositoryRoot, git, releaseCommit, registry, registryState } = await fixture();
  expect(await pushCliReleaseTag(repositoryRoot, registry)).toBe("pushed");
  expect(git("ls-remote", "--tags", "origin", "refs/tags/browse@0.10.0")).toBe(
    `${releaseCommit}\trefs/tags/browse@0.10.0`,
  );
  // A fresh checkout/rerun must recognize the remote tag without recreating it.
  git("tag", "-d", "browse@0.10.0");
  registryState.status = 503;
  expect(await pushCliReleaseTag(repositoryRoot, registry)).toBe("existing");
  expect(registryState.requests).toBe(1);
});

it("does not tag when publishing failed before npm accepted the version", async () => {
  const { repositoryRoot, git, registry, registryState } = await fixture();
  registryState.status = 404;
  expect(await pushCliReleaseTag(repositoryRoot, registry)).toBe("unpublished");
  expect(git("tag", "--list", "browse@0.10.0")).toBe("");
  registryState.status = 503;
  await expect(pushCliReleaseTag(repositoryRoot, registry)).rejects.toThrow(
    "Registry returned 503",
  );
  expect(git("ls-remote", "--tags", "origin")).toBe("");
});

it("refuses to create a missing tag on a later main commit", async () => {
  const { repositoryRoot, git, registry } = await fixture();
  git("commit", "--allow-empty", "-m", "Later main change");
  await expect(pushCliReleaseTag(repositoryRoot, registry)).rejects.toThrow(
    "rerun the original version-bump workflow",
  );
  expect(git("ls-remote", "--tags", "origin")).toBe("");
});

it("pushes an existing local publisher tag at its original commit", async () => {
  const { repositoryRoot, git, releaseCommit, registry } = await fixture();
  git("tag", "-a", "browse@0.10.0", "-m", "browse@0.10.0");
  git("commit", "--allow-empty", "-m", "Later main change");
  expect(await pushCliReleaseTag(repositoryRoot, registry)).toBe("pushed");
  expect(git("ls-remote", "--tags", "origin", "refs/tags/browse@0.10.0^{}")).toBe(
    `${releaseCommit}\trefs/tags/browse@0.10.0^{}`,
  );
});

it("refuses to push a local tag for another package version", async () => {
  const { repositoryRoot, git, registry } = await fixture();
  git("tag", "browse@0.10.0", "HEAD^");
  await expect(pushCliReleaseTag(repositoryRoot, registry)).rejects.toThrow(
    "different package version",
  );
  expect(git("ls-remote", "--tags", "origin")).toBe("");
});
