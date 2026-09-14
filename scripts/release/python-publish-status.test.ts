import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { shouldPublishPython } from "./python-publish-status.ts";

async function repositoryFixture(pyproject: string): Promise<string> {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "stagehand-python-status-"));
  await mkdir(path.join(repositoryRoot, ".changeset"));
  await mkdir(path.join(repositoryRoot, "packages/sdk-python"), { recursive: true });
  await writeFile(path.join(repositoryRoot, ".changeset/README.md"), "Changeset instructions\n");
  await writeFile(path.join(repositoryRoot, "packages/sdk-python/pyproject.toml"), pyproject);
  return repositoryRoot;
}

describe("shouldPublishPython", () => {
  it("does not publish while a changeset is pending", async () => {
    const repositoryRoot = await repositoryFixture(`[project]
  version = "4.1.0"
`);
    await writeFile(
      path.join(repositoryRoot, ".changeset/release.md"),
      `---
"@browserbasehq/stagehand-python": patch
---
`,
    );
    const fetchStatus = vi.fn();

    await expect(shouldPublishPython({ repositoryRoot, fetchStatus })).resolves.toBe(false);
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it("publishes a version that is missing from PyPI", async () => {
    const repositoryRoot = await repositoryFixture(`[project]
  version = "4.1.0"
`);
    const fetchStatus = vi.fn(async () => ({ ok: false, status: 404 }));

    await expect(shouldPublishPython({ repositoryRoot, fetchStatus })).resolves.toBe(true);
    expect(fetchStatus).toHaveBeenCalledWith("https://pypi.org/pypi/stagehand/4.1.0/json");
  });

  it("skips a version that already exists on PyPI", async () => {
    const repositoryRoot = await repositoryFixture(`[project]
version = "4.1.0"
`);

    await expect(
      shouldPublishPython({
        repositoryRoot,
        fetchStatus: async () => ({ ok: true, status: 200 }),
      }),
    ).resolves.toBe(false);
  });

  it("rejects a missing project version", async () => {
    const repositoryRoot = await repositoryFixture(`[project]
name = "stagehand"
`);

    await expect(
      shouldPublishPython({
        repositoryRoot,
        fetchStatus: async () => ({ ok: false, status: 404 }),
      }),
    ).rejects.toThrow("Could not find the Python project version");
  });

  it("rejects unexpected PyPI responses", async () => {
    const repositoryRoot = await repositoryFixture(`[project]
version = "4.1.0"
`);

    await expect(
      shouldPublishPython({
        repositoryRoot,
        fetchStatus: async () => ({ ok: false, status: 503 }),
      }),
    ).rejects.toThrow("PyPI returned 503 while checking stagehand 4.1.0");
  });
});
