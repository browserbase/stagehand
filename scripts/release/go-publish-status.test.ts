import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { goPublishStatus } from "./go-publish-status.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function repositoryFixture({
  modulePath = "github.com/browserbase/stagehand/packages/sdk-go/v4",
  version = "4.0.0",
}: {
  modulePath?: string;
  version?: string;
} = {}): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-go-status-"));
  directories.push(repositoryRoot);
  await mkdir(path.join(repositoryRoot, "packages/sdk-go"), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, "packages/sdk-go/package.json"),
    JSON.stringify({ version }),
  );
  await writeFile(path.join(repositoryRoot, "packages/sdk-go/go.mod"), `module ${modulePath}\n`);
  return repositoryRoot;
}

describe("goPublishStatus", () => {
  it("does not let pending Browse changes block the SDK release", async () => {
    const repositoryRoot = await repositoryFixture();
    await mkdir(path.join(repositoryRoot, ".changeset"));
    await writeFile(
      path.join(repositoryRoot, ".changeset/browse.md"),
      '---\n"browse": minor\n---\nCLI release\n',
    );
    expect(
      (await goPublishStatus({ repositoryRoot, tagExists: async () => false })).shouldTag,
    ).toBe(true);
  });

  it("rejects a module path that does not match the package major", async () => {
    const repositoryRoot = await repositoryFixture({ modulePath: "example.com/sdk-go" });

    await expect(goPublishStatus({ repositoryRoot })).rejects.toThrow(
      "Go module path is example.com/sdk-go; expected github.com/browserbase/stagehand/packages/sdk-go/v4 for 4.0.0",
    );
  });

  it.each(['"@browserbasehq/stagehand-go": patch', '{ "@browserbasehq/stagehand-go": patch }'])(
    "ignores pending Go changesets on the maintenance branch (%s)",
    async (frontmatter) => {
      const repositoryRoot = await repositoryFixture();
      await mkdir(path.join(repositoryRoot, ".changeset"));
      await writeFile(
        path.join(repositoryRoot, ".changeset/release.md"),
        `---\n${frontmatter}\n---\nPending\n`,
      );
      const tagExists = vi.fn(async () => false);

      await expect(goPublishStatus({ repositoryRoot, tagExists })).resolves.toEqual({
        shouldTag: true,
        tag: "packages/sdk-go/v4.0.0",
      });
      expect(tagExists).toHaveBeenCalledWith("packages/sdk-go/v4.0.0");
    },
  );

  it("does not recreate an existing tag", async () => {
    const repositoryRoot = await repositoryFixture();

    await expect(goPublishStatus({ repositoryRoot, tagExists: async () => true })).resolves.toEqual(
      { shouldTag: false, tag: "packages/sdk-go/v4.0.0" },
    );
  });

  it("returns the missing tag to create", async () => {
    const repositoryRoot = await repositoryFixture({ version: "4.1.0" });
    const tagExists = vi.fn(async () => false);

    await expect(goPublishStatus({ repositoryRoot, tagExists })).resolves.toEqual({
      shouldTag: true,
      tag: "packages/sdk-go/v4.1.0",
    });
    expect(tagExists).toHaveBeenCalledWith("packages/sdk-go/v4.1.0");
  });

  it.each(["", "v4.3.1", "4.3", "04.3.1", "not-a-version"])(
    "rejects invalid version %j before checking tags",
    async (version) => {
      const repositoryRoot = await repositoryFixture({ version });
      const tagExists = vi.fn();
      await expect(goPublishStatus({ repositoryRoot, tagExists })).rejects.toThrow(
        "Invalid Go SDK package version",
      );
      expect(tagExists).not.toHaveBeenCalled();
    },
  );

  it("fails if tag lookup fails instead of treating the tag as missing", async () => {
    const repositoryRoot = await repositoryFixture();
    await expect(
      goPublishStatus({
        repositoryRoot,
        tagExists: async () => {
          throw new Error("Tag lookup failed");
        },
      }),
    ).rejects.toThrow("Tag lookup failed");
  });

  it.each([false, true])(
    "skips an existing tag even on a later push (annotated: %s)",
    async (annotated) => {
      const repositoryRoot = await repositoryFixture({ version: "4.3.1" });
      const git = (...args: string[]) =>
        execFileSync("git", args, {
          cwd: repositoryRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
      git("init", "-b", "v4-go");
      git("config", "user.name", "Release test");
      git("config", "user.email", "test@example.com");
      git("add", ".");
      git("commit", "-m", "Prepare Go patch");
      const tag = "packages/sdk-go/v4.3.1";
      expect(await goPublishStatus({ repositoryRoot })).toEqual({ shouldTag: true, tag });
      const releaseCommit = git("rev-parse", "HEAD");
      git("tag", ...(annotated ? ["-a", tag, "-m", "Release"] : [tag]));
      expect(await goPublishStatus({ repositoryRoot })).toEqual({ shouldTag: false, tag });
      git("commit", "--allow-empty", "-m", "Later maintenance change");
      expect(await goPublishStatus({ repositoryRoot })).toEqual({ shouldTag: false, tag });
      expect(git("rev-parse", `${tag}^{commit}`)).toBe(releaseCommit);
    },
  );
});
