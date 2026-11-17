import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeInitScriptSource } from "@browserbasehq/stagehand-browser-api/pageScripts";
import { nodeBrowserApiPlatform } from "../src/nodeBrowserApiPlatform.js";

describe("Node init script loading", () => {
  it("reads init script paths and appends a source URL", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "stagehand-page-script-"));
    const filePath = path.join(directory, "init.js");

    try {
      await writeFile(filePath, "globalThis.fromPath = true", "utf8");
      await expect(
        normalizeInitScriptSource(
          { path: filePath },
          undefined,
          "page.addInitScript",
          nodeBrowserApiPlatform,
        ),
      ).resolves.toBe(`globalThis.fromPath = true\n//# sourceURL=${filePath}`);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
