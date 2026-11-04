import { Config } from "@oclif/core";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeKeyring } from "./helpers/keyring.js";
import Login from "../src/commands/login.js";
import { login } from "../src/lib/auth/login.js";
import { productionApiOrigin, readCredential, writeCredential } from "../src/lib/auth/store.js";

vi.mock("../src/lib/auth/login.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/auth/login.js")>()),
  login: vi.fn(),
}));

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("login cancellation", () => {
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
