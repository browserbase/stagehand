import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { pinPythonWorkspaceSdkVersion } from "./python-workspace.ts";

describe("Python workspace prerelease resolution", () => {
  it.each(["4.3.0.dev0+gabc123", "4.3.1a0.dev1451"])(
    "pins consumers to %s while preserving SDK dev dependencies and unrelated packages",
    async (version) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "python-workspace-"));
      try {
        const config = '[tool.uv.workspace]\nmembers = ["packages/*"]\n';
        await writeFile(path.join(root, "pyproject.toml"), config);
        const sdk =
          '[project]\nname = "stagehand"\nversion = "4.3.0"\n[dependency-groups]\ndev = ["pytest"]\n';
        for (const name of ["sdk", "consumer"])
          await mkdir(path.join(root, "packages", name), { recursive: true });
        await writeFile(path.join(root, "packages/sdk/pyproject.toml"), sdk);
        const consumer = path.join(root, "packages/consumer/pyproject.toml");
        await writeFile(
          consumer,
          '[project]\nname = "consumer"\ndependencies = ["stagehand>=4.3.0,<5", "stagehand-middleware>=0.1", "httpx<1"]\n',
        );
        await pinPythonWorkspaceSdkVersion(root, version);
        expect(parse(await readFile(consumer, "utf8"))).toEqual({
          project: {
            name: "consumer",
            dependencies: [`stagehand==${version}`, "stagehand-middleware>=0.1", "httpx<1"],
          },
        });
        expect(await readFile(path.join(root, "packages/sdk/pyproject.toml"), "utf8")).toBe(sdk);
        expect(await readFile(path.join(root, "pyproject.toml"), "utf8")).toBe(config);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
