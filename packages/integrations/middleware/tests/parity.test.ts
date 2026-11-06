import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const pythonPackage = new URL("../../core/python/", import.meta.url);

// The npm and PyPI `stagehand-middleware` packages ship the same facade and
// release under the same version.
it("ships the same facade bundle as the Python package", async () => {
  // Load the built package in plain Node, as consumers do: the bundle carries
  // Function#toString sources, which a test transform would change.
  const dist = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));
  const builtSha = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(dist)}); process.stdout.write(m.facadeBundle("0.0.0").sha256);`,
    ],
    { encoding: "utf8" },
  );
  const vendored = JSON.parse(
    await readFile(new URL("src/stagehand_middleware/facade/_bundle.json", pythonPackage), "utf8"),
  ) as { sha256: string };
  expect(builtSha).toBe(vendored.sha256);
});

it("has the same version as the Python package", async () => {
  const npmVersion = (
    JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    }
  ).version;
  const pyproject = await readFile(new URL("pyproject.toml", pythonPackage), "utf8");
  expect(pyproject.match(/^version = "([^"]+)"$/m)?.[1]).toBe(npmVersion);
});
