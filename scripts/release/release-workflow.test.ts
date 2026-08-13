import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("release workflow", () => {
  it("does not couple the Go release to another SDK release", async () => {
    const workflow = await readFile(path.resolve(".github/workflows/release.yml"), "utf8");
    const publishGo = /^  publish-go:\n(?<job>(?: {4}.*\n|\n)*)/mu.exec(workflow)?.groups?.job;

    expect(publishGo).toBeDefined();
    expect(publishGo).not.toMatch(/^ {4}needs:/mu);
  });
});
