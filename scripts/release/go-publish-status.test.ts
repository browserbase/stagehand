import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { goPublishStatus } from "./go-publish-status.ts";

async function repositoryFixture({
  modulePath = "github.com/browserbase/stagehand/packages/sdk-go/v4",
  version = "4.0.0",
}: {
  modulePath?: string;
  version?: string;
} = {}): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-go-status-"));
  await mkdir(path.join(repositoryRoot, ".changeset"));
  await mkdir(path.join(repositoryRoot, "packages/sdk-go"), { recursive: true });
  await writeFile(path.join(repositoryRoot, ".changeset/README.md"), "Changeset instructions\n");
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

  it("does not tag while a changeset is pending", async () => {
    const repositoryRoot = await repositoryFixture();
    await writeFile(
      path.join(repositoryRoot, ".changeset/release.md"),
      '---\n"@browserbasehq/stagehand-go": patch\n---\nPending\n',
    );
    const tagExists = vi.fn();

    await expect(goPublishStatus({ repositoryRoot, tagExists })).resolves.toEqual({
      shouldTag: false,
      tag: "packages/sdk-go/v4.0.0",
    });
    expect(tagExists).not.toHaveBeenCalled();
  });

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
});
