/**
 * Cross-version compatibility: the CURRENT sdk-ts against the extension that shipped in the LAST
 * PUBLISHED `@browserbasehq/stagehand` release.
 *
 * Unit tests fake the runtime marker; this test drives the real negotiation end to end in a real
 * Chromium so a release cannot silently break the handshake (or regress fail-fast back to the
 * 60 s init timeout). The expected outcome is COMPUTED from `checkProtocolCompatibility`, never
 * hardcoded, so it keeps meaning when the protocol version moves.
 *
 * Network: fetches the published tarball with `npm pack` on first run; cached (gitignored) under
 * node_modules/.cache. Override the baseline with STAGEHAND_COMPAT_BASELINE_VERSION.
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  checkProtocolCompatibility,
  STAGEHAND_PROTOCOL_VERSION,
} from "@browserbasehq/stagehand-protocol/protocol-version";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import {
  CDPClient,
  loadUnpackedExtension,
  openCDPWebSocket,
  resolveBrowserWebSocketUrl,
  StagehandRuntimeIncompatibleError,
  waitForServiceWorker,
} from "../../src/cdpClient.js";
import { Stagehand, type StagehandBrowser } from "../../src/index.js";
import { STAGEHAND_INIT_TIMEOUT_MS } from "../../src/timeouts.js";

const execFileAsync = promisify(execFile);

const PACKAGE_NAME = "@browserbasehq/stagehand";
const BASELINE_SPEC = process.env.STAGEHAND_COMPAT_BASELINE_VERSION?.trim() || "latest";
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CACHE_ROOT = path.join(REPO_ROOT, "node_modules", ".cache", "stagehand-cross-version");
/** Upper bound for an incompatible runtime to be rejected. Far below the 60 s init timeout. */
const FAIL_FAST_BUDGET_MS = 5_000;

type BaselineExtension = {
  version: string;
  extensionDir: string;
};

type RuntimeMarker = {
  protocolVersion: string;
  serverInfo: { name: string; version: string };
};

type FixtureServer = { url: string; close(): Promise<void> };

describe("cross-version compatibility against the last published extension", () => {
  let baseline: BaselineExtension;
  let baselineMarker: RuntimeMarker;
  let fixtureServer: FixtureServer;
  const cleanups: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    expect(STAGEHAND_INIT_TIMEOUT_MS).toBeGreaterThan(FAIL_FAST_BUDGET_MS);
    baseline = await obtainBaselineExtension();
    baselineMarker = await readRuntimeMarker(baseline.extensionDir);
    fixtureServer = await startFixtureServer();
  }, 180_000);

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  afterAll(async () => {
    await fixtureServer?.close();
  });

  it("negotiates with the published extension exactly as checkProtocolCompatibility predicts", async () => {
    const expected = checkProtocolCompatibility(
      STAGEHAND_PROTOCOL_VERSION,
      baselineMarker.protocolVersion,
    );
    expect(baselineMarker.serverInfo.name).toBe("stagehand");

    const outcome = await launchThroughSdk(baseline.extensionDir, cleanups);

    if (expected.compatible) {
      if (!outcome.browser) throw outcome.error;
      const stagehand = await Stagehand.create({ browser: outcome.browser });
      cleanups.push(() => stagehand.close());
      const page = await stagehand.browser.context.newPage();
      await page.goto(fixtureServer.url);
      expect(await page.url()).toBe(fixtureServer.url);
      expect(await page.title()).toBe("Cross-version fixture");
    } else {
      expect(outcome.browser, "connect should have been rejected").toBeUndefined();
      expect(outcome.error).toBeInstanceOf(StagehandRuntimeIncompatibleError);
      const error = outcome.error as StagehandRuntimeIncompatibleError;
      expect(error.reason).toBe(expected.reason);
      expect(error.clientProtocolVersion).toBe(STAGEHAND_PROTOCOL_VERSION);
      expect(error.reportedProtocolVersion).toBe(baselineMarker.protocolVersion);
      expect(outcome.elapsedMs).toBeLessThan(FAIL_FAST_BUDGET_MS);
    }
  }, 120_000);

  it("fails fast with protocol-major-mismatch when the published extension reports the next major", async () => {
    const nextMajor = `${Number(STAGEHAND_PROTOCOL_VERSION.split(".")[0]) + 1}.0.0`;
    const expected = checkProtocolCompatibility(STAGEHAND_PROTOCOL_VERSION, nextMajor);
    expect(expected).toStrictEqual({ compatible: false, reason: "protocol-major-mismatch" });

    const mutatedDir = await forkExtensionWithProtocolVersion(baseline.extensionDir, nextMajor);
    cleanups.push(() => rm(mutatedDir, { recursive: true, force: true }));
    // Prove the mutation took in the real browser before asserting on negotiation.
    const mutatedMarker = await readRuntimeMarker(mutatedDir);
    expect(mutatedMarker.protocolVersion).toBe(nextMajor);
    expect(mutatedMarker.serverInfo).toStrictEqual(baselineMarker.serverInfo);

    const outcome = await launchThroughSdk(mutatedDir, cleanups);

    expect(outcome.browser, "connect should have been rejected").toBeUndefined();
    expect(outcome.error).toBeInstanceOf(StagehandRuntimeIncompatibleError);
    const error = outcome.error as StagehandRuntimeIncompatibleError;
    expect(error.reason).toBe("protocol-major-mismatch");
    expect(error.clientProtocolVersion).toBe(STAGEHAND_PROTOCOL_VERSION);
    expect(error.reportedProtocolVersion).toBe(nextMajor);
    expect(error.serverInfo).toStrictEqual(baselineMarker.serverInfo);
    expect(outcome.elapsedMs).toBeLessThan(FAIL_FAST_BUDGET_MS);
  }, 120_000);
});

/**
 * Drives the SDK's own `localBrowser.launch` path (init deadline, connectBrowser, CDPClient.connect,
 * runtime negotiation). The only seam is `connectCdp`, which pins `extensionDir` to the extension
 * under test instead of the package's bundled build. Timing starts once Chrome is up so it
 * measures negotiation, not browser start-up.
 */
async function launchThroughSdk(
  extensionDir: string,
  cleanups: Array<() => Promise<void>>,
): Promise<{ browser?: StagehandBrowser; error?: unknown; elapsedMs: number }> {
  let startedAt: number | undefined;
  const { localBrowser } = createBrowserFactoriesForTest({
    launchLocalBrowser: async (options, signal) => {
      const launched = await launchLocalBrowser(options, signal);
      startedAt = performance.now();
      return launched;
    },
    connectCdp: (options) => CDPClient.connect({ ...options, extensionDir }),
  });

  try {
    const browser = await localBrowser.launch({ headless: true });
    cleanups.push(() => browser.close());
    return { browser, elapsedMs: performance.now() - (startedAt ?? Number.NaN) };
  } catch (error) {
    return { error, elapsedMs: performance.now() - (startedAt ?? Number.NaN) };
  }
}

/** Resolves `npm pack` output into a cached, unpacked `dist/extension` of the published SDK. */
async function obtainBaselineExtension(): Promise<BaselineExtension> {
  const version = await npmJson<string>(["view", `${PACKAGE_NAME}@${BASELINE_SPEC}`, "version"]);
  expect(version, `could not resolve ${PACKAGE_NAME}@${BASELINE_SPEC}`).toMatch(/^\d+\.\d+\.\d+/);
  const versionDir = path.join(CACHE_ROOT, version);
  const extensionDir = path.join(versionDir, "extension");

  if (await exists(path.join(extensionDir, "manifest.json"))) return { version, extensionDir };

  const scratch = await mkdtemp(path.join(tmpdir(), "stagehand-compat-pack-"));
  try {
    const packed = await npmJson<Array<{ filename: string }>>([
      "pack",
      `${PACKAGE_NAME}@${version}`,
      "--pack-destination",
      scratch,
    ]);
    const tarball = path.join(scratch, packed[0].filename);
    await execFileAsync("tar", ["-xzf", tarball, "-C", scratch, "package/dist/extension"]);
    const unpacked = path.join(scratch, "package", "dist", "extension");
    expect(await exists(path.join(unpacked, "manifest.json"))).toBe(true);

    await rm(versionDir, { recursive: true, force: true });
    await mkdir(versionDir, { recursive: true });
    await cp(unpacked, extensionDir, { recursive: true });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return { version, extensionDir };
}

/**
 * Copies an extension and rewrites the protocolVersion its service worker publishes on
 * `__stagehand_runtime`. Targets the marker assignment only, so the extension's own handshake
 * logic and everything else in the bundle stay untouched.
 */
async function forkExtensionWithProtocolVersion(
  sourceDir: string,
  protocolVersion: string,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "stagehand-compat-mutated-"));
  await cp(sourceDir, dir, { recursive: true });
  const workerPath = path.join(dir, "service-worker.js");
  const source = await readFile(workerPath, "utf8");
  const markerAssignment = /(__stagehand_runtime\s*=\s*\{\s*protocolVersion:\s*)("[^"]*"|[\w$.]+)/g;
  const matches = [...source.matchAll(markerAssignment)];
  expect(matches, "expected exactly one __stagehand_runtime marker assignment").toHaveLength(1);
  await writeFile(
    workerPath,
    source.replace(markerAssignment, `$1${JSON.stringify(protocolVersion)}`),
  );
  return dir;
}

/**
 * Reads `globalThis.__stagehand_runtime` straight from the extension's service worker with raw
 * CDP. Deliberately bypasses the SDK's negotiation so the expectation is independent of the code
 * under test.
 */
async function readRuntimeMarker(extensionDir: string): Promise<RuntimeMarker> {
  const signal = AbortSignal.timeout(60_000);
  const chrome = await launchLocalBrowser({ headless: true }, signal);
  let client: CDPClient | undefined;
  try {
    const wsUrl = await resolveBrowserWebSocketUrl(chrome.cdpUrl, { signal });
    client = new CDPClient(await openCDPWebSocket(wsUrl, signal), wsUrl);
    const extensionId = await loadUnpackedExtension(client, extensionDir, signal);
    const worker = await waitForServiceWorker(client, { extensionId, signal });
    const { sessionId } = await client.sendCommand<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId: worker.targetId, flatten: true },
      undefined,
      signal,
    );
    while (true) {
      const evaluated = await client.sendCommand<{ result?: { value?: unknown } }>(
        "Runtime.evaluate",
        {
          expression: "JSON.stringify(globalThis.__stagehand_runtime ?? null)",
          returnByValue: true,
        },
        sessionId,
        signal,
      );
      const raw = evaluated.result?.value;
      if (typeof raw === "string" && raw !== "null") return JSON.parse(raw) as RuntimeMarker;
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    client?.close();
    await chrome.close();
  }
}

async function npmJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileAsync("npm", [...args, "--json", "--loglevel=error"], {
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
  return JSON.parse(stdout) as T;
}

async function exists(filePath: string): Promise<boolean> {
  return await stat(filePath).then(
    () => true,
    () => false,
  );
}

async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Cross-version fixture</title><h1>ok</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("unexpected address");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
