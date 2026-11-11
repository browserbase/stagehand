import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { isProcessAlive } from "../src/lib/driver/daemon/process.js";
import { writeNodeExecutable } from "./helpers/node-executable.js";
import { runCli } from "./helpers/run-cli.js";

it("terminates the CLI behind a command shim when its timeout expires", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browse runner timeout-"));
  const pidFile = join(directory, "child.pid");
  try {
    await writeNodeExecutable(
      directory,
      "fixture",
      [
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        'process.stdout.write("fixture stdout");',
        'process.stderr.write("fixture stderr");',
        // Keep the inherited pipes open. Killing only cmd.exe must not satisfy the test.
        // Bound the fixture lifetime so a broken tree kill cannot hang CI indefinitely.
        "setTimeout(() => {}, 15_000);",
      ].join("\n"),
    );
    const start = Date.now();
    const result = runCli([], {
      executable: join(directory, process.platform === "win32" ? "fixture.cmd" : "fixture"),
      cwd: directory,
      timeoutMs: 1_500,
      env: { PATH: directory },
    });

    await expect(result).rejects.toThrow("CLI timed out after 1500ms:");
    await expect(result).rejects.toThrow(directory);
    await expect(result).rejects.toThrow("stdout: fixture stdout");
    await expect(result).rejects.toThrow("stderr: fixture stderr");
    expect(Date.now() - start).toBeLessThan(10_000);
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(pid).toBeGreaterThan(0);
    await expect.poll(() => isProcessAlive(pid), { timeout: 2_000 }).toBe(false);
  } finally {
    const pid = Number(await readFile(pidFile, "utf8").catch(() => ""));
    if (pid > 0 && isProcessAlive(pid)) killRemainingChild(pid);
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

function killRemainingChild(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
