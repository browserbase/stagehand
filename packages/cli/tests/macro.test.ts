import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appendMacroStepIfRecording,
  startMacroRecording,
  stopMacroRecording,
} from "../src/lib/macro/recording.js";
import { replayMacro } from "../src/lib/macro/replay.js";
import {
  listMacroNames,
  loadMacro,
  macrosDir,
  recordingStatePath,
} from "../src/lib/macro/store.js";

const tempDirs: string[] = [];

async function useTempMacroDirs(): Promise<void> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "browse-macro-test-"));
  tempDirs.push(base);
  process.env.BROWSE_MACRO_DIR = path.join(base, "macros");
  process.env.BROWSE_DAEMON_DIR = path.join(base, "runtime");
}

async function cleanupTempDirs(): Promise<void> {
  delete process.env.BROWSE_MACRO_DIR;
  delete process.env.BROWSE_DAEMON_DIR;
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
}

vi.mock("../src/lib/driver/runtime.js", () => ({
  runDriverCommandWithTarget: vi.fn(async () => ({ ok: true })),
}));

import { runDriverCommandWithTarget } from "../src/lib/driver/runtime.js";

describe("macro store and recording", () => {
  beforeEach(async () => {
    await useTempMacroDirs();
  });

  afterEach(async () => {
    await cleanupTempDirs();
    vi.mocked(runDriverCommandWithTarget).mockClear();
  });

  it("records successful driver commands while recording is active", async () => {
    await startMacroRecording("login-flow");
    await appendMacroStepIfRecording("open", {
      url: "https://example.com",
    });
    await appendMacroStepIfRecording("click", { selector: "@0-1" });

    const macro = await stopMacroRecording();
    expect(macro.name).toBe("login-flow");
    expect(macro.steps).toEqual([
      { command: "open", params: { url: "https://example.com" } },
      { command: "click", params: { selector: "@0-1" } },
    ]);

    const loaded = await loadMacro("login-flow");
    expect(loaded.steps).toHaveLength(2);
    expect(await listMacroNames()).toEqual(["login-flow"]);
    await expect(fs.readFile(recordingStatePath(), "utf8")).rejects.toThrow();
  });

  it("skips non-recordable commands", async () => {
    await startMacroRecording("inspect-only");
    await appendMacroStepIfRecording("snapshot", {});
    await appendMacroStepIfRecording("refs", {});

    const macro = await stopMacroRecording();
    expect(macro.steps).toEqual([]);
  });

  it("replays macro steps through the driver runtime", async () => {
    await startMacroRecording("checkout");
    await appendMacroStepIfRecording("fill", {
      selector: "@0-2",
      value: "test@example.com",
    });
    await appendMacroStepIfRecording("click", { selector: "@0-3" });
    await stopMacroRecording();

    const { macro, results } = await replayMacro({
      delayMs: 0,
      name: "checkout",
      session: "default",
      target: { kind: "managed-local" },
    });

    expect(macro.steps).toHaveLength(2);
    expect(results).toHaveLength(2);
    expect(runDriverCommandWithTarget).toHaveBeenCalledTimes(2);
    expect(runDriverCommandWithTarget).toHaveBeenNthCalledWith(
      1,
      "default",
      { kind: "managed-local" },
      "fill",
      { selector: "@0-2", value: "test@example.com" },
    );
  });

  it("rejects duplicate macro names when starting a recording", async () => {
    await startMacroRecording("login-flow");
    await stopMacroRecording();

    await expect(startMacroRecording("login-flow")).rejects.toThrow(
      "already exists",
    );
  });

  it("stores macros in the configured directory", async () => {
    await startMacroRecording("paths");
    await stopMacroRecording();

    const file = path.join(macrosDir(), "paths.json");
    await expect(fs.access(file)).resolves.toBeUndefined();
  });
});
