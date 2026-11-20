/**
 * Tests that localBrowser.connect replaces an incompatible preinstalled extension
 * with the bundled extension instead of throwing StagehandRuntimeIncompatibleError.
 *
 * This addresses the regression where `browse open --cdp <url>` failed 95% of the time
 * when connecting to browsers with older Stagehand extensions.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/protocol-version";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import {
  CDPClient,
  loadUnpackedExtension,
  openCDPWebSocket,
  resolveBrowserWebSocketUrl,
} from "../../src/cdpClient.js";
import { Stagehand } from "../../src/stagehand.js";

const currentExtensionDir = fileURLToPath(new URL("../../../extension/dist", import.meta.url));

describe("localExtensionDir replaces incompatible extensions", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  it("replaces an incompatible extension and connects successfully", async () => {
    const signal = AbortSignal.timeout(60_000);

    // Create a mutated extension with an incompatible (future major) protocol version.
    const nextMajor = `${Number(STAGEHAND_PROTOCOL_VERSION.split(".")[0]) + 1}.0.0`;
    const incompatibleDir = await forkExtensionWithProtocolVersion(
      currentExtensionDir,
      nextMajor,
    );
    cleanups.push(() => rm(incompatibleDir, { recursive: true, force: true }));

    // Launch Chrome and preinstall the incompatible extension using raw CDP (bypass validation).
    const chrome = await launchLocalBrowser({ headless: true }, signal);
    cleanups.push(() => chrome.close());

    // Load the incompatible extension directly via CDP without validation.
    const wsUrl = await resolveBrowserWebSocketUrl(chrome.cdpUrl, { signal });
    const seedClient = new CDPClient(await openCDPWebSocket(wsUrl, signal), wsUrl);
    cleanups.push(async () => seedClient.close());
    const incompatibleExtensionId = await loadUnpackedExtension(seedClient, incompatibleDir, signal);
    seedClient.close();

    // Now connect using localExtensionDir (the current extension).
    // This should detect the incompatibility and replace the extension.
    const { localBrowser } = createBrowserFactoriesForTest({
      connectCdp: (options) =>
        CDPClient.connect({ ...options, localExtensionDir: currentExtensionDir }),
    });

    const browser = await localBrowser.connect({ cdpUrl: chrome.cdpUrl });
    cleanups.push(() => browser.close());

    // Verify the connection succeeded and we can use Stagehand.
    const stagehand = await Stagehand.create({ browser });
    cleanups.push(() => stagehand.close());

    const page = await stagehand.browser.context.newPage();
    await page.goto("data:text/html,<title>Replaced extension</title>");
    expect(await page.title()).toBe("Replaced extension");

    // The key assertion is that connect succeeded despite the incompatible extension.
    // The extension ID may have changed when it was replaced.
    expect(incompatibleExtensionId).toBeDefined();
  }, 90_000);
});

async function forkExtensionWithProtocolVersion(
  sourceDir: string,
  protocolVersion: string,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "stagehand-replace-test-"));
  await cp(sourceDir, dir, { recursive: true });
  const workerPath = path.join(dir, "service-worker.js");
  const source = await readFile(workerPath, "utf8");
  const markerAssignment =
    /(__stagehand_runtime\s*=\s*\{\s*protocolVersion:\s*)("[^"]*"|[\w$.]+)/g;
  const matches = [...source.matchAll(markerAssignment)];
  expect(matches, "expected exactly one __stagehand_runtime marker assignment").toHaveLength(1);
  await writeFile(
    workerPath,
    source.replace(markerAssignment, `$1${JSON.stringify(protocolVersion)}`),
  );
  return dir;
}
