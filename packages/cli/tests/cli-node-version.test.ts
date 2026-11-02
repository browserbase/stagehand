import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const entrypoint = new URL("../bin/run.js", import.meta.url).href;

function runWithNodeVersion(version: string) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });
       process.argv = [process.execPath, ${JSON.stringify(entrypoint)}, "--version"];
       await import(${JSON.stringify(entrypoint)});`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BROWSE_LOAD_DOTENV: "0",
        BROWSE_DISABLE_UPDATE_CHECK: "1",
        NODE_ENV: "test",
      },
    },
  );
}

describe("Node.js runtime requirement", () => {
  it.each(["20.20.2", "22.12.0", "22.17.0"])(
    "rejects Node.js %s with an upgrade message before loading commands",
    (version) => {
      const result = runWithNodeVersion(version);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        `[browse] Node.js >=22.18.0 is required; found ${version}. Upgrade Node.js and rerun browse.\n`,
      );
    },
  );

  it.each(["22.18.0", "22.23.3", "24.18.0"])(
    "runs commands on supported Node.js %s",
    (version) => {
      const result = runWithNodeVersion(version);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("browse/");
      expect(result.stderr).not.toContain("Upgrade Node.js");
    },
  );
});
