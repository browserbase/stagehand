import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { writeNodeExecutable } from "./helpers/node-executable.js";

it.each([0, 17])(
  "runs fixture commands with a restricted PATH and exit code %i",
  async (exitCode) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "browse fake bin-")));
    try {
      await writeNodeExecutable(
        directory,
        "fixture",
        [
          "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));",
          'process.stderr.write("fixture stderr");',
          "process.exitCode = Number(process.env.FIXTURE_EXIT_CODE);",
        ].join("\n"),
      );
      const args = ["hello world", "a&b", "*", ""];
      const commandLine = ["fixture", ...args.map((arg) => '"' + arg + '"')].join(" ");
      const result =
        process.platform === "win32"
          ? spawnSync(
              process.env.ComSpec ?? "cmd.exe",
              ["/d", "/s", "/c", '"' + commandLine + '"'],
              {
                windowsVerbatimArguments: true,
                cwd: directory,
                env: { ...process.env, PATH: directory, FIXTURE_EXIT_CODE: String(exitCode) },
                encoding: "utf8",
                timeout: 5_000,
              },
            )
          : spawnSync("fixture", args, {
              cwd: directory,
              env: { ...process.env, PATH: directory, FIXTURE_EXIT_CODE: String(exitCode) },
              encoding: "utf8",
              timeout: 5_000,
            });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(exitCode);
      expect(JSON.parse(result.stdout)).toEqual({
        args,
        cwd: directory,
      });
      expect(result.stderr).toBe("fixture stderr");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
