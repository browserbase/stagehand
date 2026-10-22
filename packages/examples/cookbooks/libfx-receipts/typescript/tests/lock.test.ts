import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { exclusive } from "../src/cli.js";

void test(
  "a competing process waits for the live owner instead of overwriting it",
  { timeout: 10_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cookbook-live-lock-"));
    let releaseOwner!: () => void;
    let ownerReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      ownerReady = resolve;
    });
    const owner = exclusive(async () => {
      ownerReady();
      await new Promise<void>((resolve) => {
        releaseOwner = resolve;
      });
    }, directory);
    try {
      await ready;
      let entered = false;
      const second = exclusive(async () => {
        entered = true;
      }, directory);
      await setTimeout(100);
      assert.equal(entered, false);
      releaseOwner();
      await owner;
      await second;
      assert.equal(entered, true);
    } finally {
      releaseOwner();
      await owner;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

void test(
  "resume waits for a killed process's lock to become stale and preserves saved intent",
  { timeout: 10_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cookbook-crash-lock-"));
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("./fixtures/hold-lock.ts", import.meta.url)),
        directory,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        child.stdout.on("data", (data) => {
          output += data;
          if (output.includes("locked\n")) resolve();
        });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
          if (!output.includes("locked\n"))
            reject(new Error(`Lock holder exited: ${code ?? signal}`));
        });
      });
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      const resumed = exclusive(async () => {
        assert.deepEqual(JSON.parse(await readFile(join(directory, "saved.json"), "utf8")), {
          attempted: true,
        });
      }, directory);
      await setTimeout(200);
      // Advance only the orphan's age; production keeps the full 30-second stale interval.
      const stale = new Date(Date.now() - 31_000);
      await utimes(`${directory}.lock`, stale, stale);
      await resumed;
    } finally {
      child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
      await rm(`${directory}.lock`, { recursive: true, force: true });
    }
  },
);
