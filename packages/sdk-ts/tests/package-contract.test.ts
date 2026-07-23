import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";

const execFileAsync = promisify(execFile);
const sdkRoot = new URL("..", import.meta.url);

describe("published TypeScript SDK", () => {
  it("installs the tarball and resolves both packaged extension artifacts", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "stagehand package contract with spaces "),
    );
    const tarballPath = path.join(temporaryRoot, "stagehand-sdk.tgz");
    const consumerDirectory = path.join(temporaryRoot, "consumer with spaces");

    try {
      await execFileAsync("vp", ["pm", "pack", "--out", tarballPath], {
        cwd: sdkRoot,
      });
      await mkdir(consumerDirectory);
      await writeFile(
        path.join(consumerDirectory, "package.json"),
        `${JSON.stringify(
          {
            private: true,
            type: "module",
            packageManager: "pnpm@11.10.0",
            dependencies: {
              "@browserbasehq/stagehand": "file:../stagehand-sdk.tgz",
            },
          },
          null,
          2,
        )}\n`,
      );
      await execFileAsync("vp", ["install", "--prefer-offline", "--ignore-scripts"], {
        cwd: consumerDirectory,
      });
      await writeFile(
        path.join(consumerDirectory, "verify.mjs"),
        `
            import { access, readFile } from "node:fs/promises";
            import { fileURLToPath } from "node:url";
            import { Stagehand } from "@browserbasehq/stagehand";

            if (typeof Stagehand !== "function") throw new Error("Stagehand export is unavailable");
            const entryUrl = import.meta.resolve("@browserbasehq/stagehand");
            const archiveUrl = new URL("./assets/stagehand-extension.zip", entryUrl);
            const manifestUrl = new URL("./extension/manifest.json", entryUrl);
            await access(fileURLToPath(archiveUrl));
            const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), "utf8"));
            if (manifest.manifest_version !== 3) throw new Error("Invalid packaged manifest");
          `,
      );

      await execFileAsync(process.execPath, [path.join(consumerDirectory, "verify.mjs")], {
        cwd: consumerDirectory,
      });
      expect(
        JSON.parse(await readFile(path.join(consumerDirectory, "package.json"), "utf8")),
      ).toMatchObject({ private: true });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }, 120_000);
});
