import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi, type MockInstance } from "vitest";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { CDPClient } from "../../src/cdpClient.js";

const stagehandExtensionDistDir = fileURLToPath(
  new URL("../../../extension/dist", import.meta.url),
);

it("replaces the worker a profile kept from another build at the same path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "stagehand-stale-worker-"));
  const extensionDir = path.join(root, "extension");
  const userDataDir = path.join(root, "profile");
  const sendCommand = vi.spyOn(CDPClient.prototype, "sendCommand");
  try {
    await cp(stagehandExtensionDistDir, extensionDir, { recursive: true });
    const buildA = (await readFile(path.join(extensionDir, "build-id.txt"), "utf8")).trim();
    const buildB = createHash("sha256").update(buildA).digest("hex");

    expect(await connect(extensionDir, userDataDir, sendCommand)).toEqual({
      firstRead: { running: buildA, onDisk: buildA },
      uninstalls: 0,
      running: buildA,
    });

    for (const file of ["service-worker.js", "build-id.txt"]) {
      const target = path.join(extensionDir, file);
      await writeFile(target, (await readFile(target, "utf8")).replaceAll(buildA, buildB));
    }
    const manifestPath = path.join(extensionDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
    manifest.version = manifest.version.replace(/\d+$/u, (last) => String(Number(last) + 1));
    await writeFile(manifestPath, JSON.stringify(manifest));

    expect(await connect(extensionDir, userDataDir, sendCommand)).toEqual({
      firstRead: { running: buildA, onDisk: buildB },
      uninstalls: 1,
      running: buildB,
    });
  } finally {
    sendCommand.mockRestore();
    await rm(root, { force: true, recursive: true });
  }
}, 120_000);

async function connect(
  extensionDir: string,
  userDataDir: string,
  sendCommand: MockInstance<CDPClient["sendCommand"]>,
) {
  const signal = AbortSignal.timeout(60_000);
  const chrome = await launchLocalBrowser({ headless: true, userDataDir }, signal);
  let client: CDPClient | undefined;
  sendCommand.mockClear();
  try {
    client = await CDPClient.connect({ cdpUrl: chrome.cdpUrl, extensionDir, signal });
    const calls = sendCommand.mock.calls;
    const buildReads = await Promise.all(
      calls.flatMap(([method, params], index) =>
        method === "Runtime.evaluate" && String(params?.expression).includes("build-id.txt")
          ? [sendCommand.mock.results[index]?.value as Promise<{ result: { value: unknown } }>]
          : [],
      ),
    );
    const evaluated = await client.sendCommand<{ result: { value: unknown } }>(
      "Runtime.evaluate",
      { expression: "globalThis.__stagehand_build_id", returnByValue: true },
      client.sessionId,
      signal,
    );
    return {
      firstRead: buildReads.map(({ result }) => result.value).find((value) => value !== null),
      uninstalls: calls.filter(([method]) => method === "Extensions.uninstall").length,
      running: evaluated.result.value,
    };
  } finally {
    // A graceful exit stores the worker registration; a signal can lose it under load.
    await client?.sendCommand("Browser.close").catch(() => {});
    client?.close();
    await chrome.close();
  }
}
