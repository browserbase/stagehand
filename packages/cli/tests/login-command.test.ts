import { Config } from "@oclif/core";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeKeyring } from "./helpers/keyring.js";
import Login from "../src/commands/login.js";
import { login } from "../src/lib/auth/login.js";
import {
  credentialPath,
  productionApiOrigin,
  readCredential,
  savedCredentialStore,
  writeCredential,
} from "../src/lib/auth/store.js";

vi.mock("../src/lib/auth/login.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/auth/login.js")>()),
  login: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("login command", () => {
  it("defaults to automatic file fallback and reports plaintext storage without exposing the key", async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "browse-fallback-test-")));
    directories.push(directory);
    vi.stubEnv("BROWSERBASE_CONFIG_DIR", directory);
    fakeKeyring().state.unavailable = true;
    const credential = {
      apiKey: "synthetic-new-key",
      projectId: "00000000-0000-4000-8000-000000000001",
      apiOrigin: productionApiOrigin,
    };
    vi.mocked(login).mockResolvedValue({ ...credential });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: credential.projectId })));
    const config = await Config.load(fileURLToPath(new URL("..", import.meta.url)));
    const command = new Login([], config);
    const log = vi.spyOn(command, "log").mockImplementation(() => {});
    await command.run();
    expect(savedCredentialStore()).toBe("file");
    expect(readCredential()).toEqual(credential);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain(`API key saved as plaintext in a private file: ${credentialPath()}`);
    expect(output).toContain("Signed in.");
    expect(output).not.toContain(credential.apiKey);
  });

  it("finishes login while the browser opener remains running", async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "browse-opener-test-")));
    directories.push(directory);
    vi.stubEnv("BROWSERBASE_CONFIG_DIR", directory);
    fakeKeyring();
    const credential = {
      apiKey: "synthetic-opener-key",
      projectId: "00000000-0000-4000-8000-000000000001",
      apiOrigin: productionApiOrigin,
    };
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    vi.mocked(spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child as ChildProcess;
    });
    vi.mocked(login).mockImplementation(async (options) => {
      await options!.openBrowser!("https://example.invalid/authorize");
      return { ...credential };
    });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: credential.projectId })));
    const config = await Config.load(fileURLToPath(new URL("..", import.meta.url)));
    const command = new Login([], config);
    vi.spyOn(command, "log").mockImplementation(() => {});
    await command.run();
    expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    expect(child.unref).toHaveBeenCalledOnce();
    expect(readCredential()).toEqual(credential);
  });

  it("preserves the previous login when SIGINT arrives during project verification", async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "browse-cancel-test-")));
    directories.push(directory);
    vi.stubEnv("BROWSERBASE_CONFIG_DIR", directory);
    const previous = {
      apiKey: "synthetic-previous-key",
      projectId: "00000000-0000-4000-8000-000000000001",
      apiOrigin: productionApiOrigin,
    };
    fakeKeyring();
    writeCredential(previous);
    vi.mocked(login).mockResolvedValue({ ...previous, apiKey: "synthetic-new-key" });
    let verificationSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      verificationSignal = init?.signal;
      process.emit("SIGINT");
      // Exercise the race even if the transport completes as cancellation arrives.
      return new Response(JSON.stringify({ id: previous.projectId }));
    });
    const config = await Config.load(fileURLToPath(new URL("..", import.meta.url)));
    const command = new Login([], config);
    vi.spyOn(command, "log").mockImplementation(() => {});
    await expect(command.run()).rejects.toThrow("canceled");
    expect(verificationSignal?.aborted).toBe(true);
    expect(readCredential()).toEqual(previous);
  });
});
