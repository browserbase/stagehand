import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LocalBrowserLaunchOptions } from "../clientSchemas.js";
import { abortable, abortableDelay, throwIfAborted } from "../abort.js";

const CHROME_POLL_INTERVAL_MS = 100;
const CHROME_REQUEST_TIMEOUT_MS = 100;
const CHROME_TERMINATION_TIMEOUT_MS = 3_000;

export const DEFAULT_CHROME_FLAGS = [
  "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider," +
    "CalculateNativeWinOcclusion,InterestFeedContentSuggestions," +
    "CertificateTransparencyComponentUpdater,AutofillServerCommunication," +
    "PrivacySandboxSettings4,RenderDocument",
  "--disable-component-extensions-with-background-pages",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-client-side-phishing-detection",
  "--disable-sync",
  "--metrics-recording-only",
  "--disable-default-apps",
  "--mute-audio",
  "--no-default-browser-check",
  "--no-first-run",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--disable-ipc-flooding-protection",
  "--password-store=basic",
  "--use-mock-keychain",
  "--force-fieldtrials=*BackgroundTracing/default/",
  "--disable-hang-monitor",
  "--disable-prompt-on-repost",
  "--disable-domain-reliability",
  "--propagate-iph-for-testing",
  "--enable-unsafe-extension-debugging",
  "--remote-allow-origins=*",
  "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
] as const;

type ChromeProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

type ChromeProcessMonitor = {
  spawned: Promise<void>;
  exited: Promise<ChromeProcessExit>;
  currentExit(): ChromeProcessExit | undefined;
};

type LocalBrowserLauncherDependencies = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  getuid: (() => number) | undefined;
  isExecutableFile(filePath: string): Promise<boolean>;
  mkdir(directory: string, options: { recursive: true; mode: number }): Promise<string | undefined>;
  mkdtemp(prefix: string): Promise<string>;
  rm(directory: string, options: { force: true; recursive: true }): Promise<void>;
  spawnChrome(executablePath: string, args: string[], options: SpawnChromeOptions): ChildProcess;
  fetch: typeof globalThis.fetch;
  findAvailablePort(): Promise<number>;
  assertPortAvailable(port: number): Promise<void>;
  signalProcess(pid: number, signal: NodeJS.Signals): void;
  runTaskkill(pid: number, force: boolean): Promise<void>;
};

type SpawnChromeOptions = {
  detached: boolean;
  env: NodeJS.ProcessEnv;
};

const defaultDependencies: LocalBrowserLauncherDependencies = {
  platform: process.platform,
  env: process.env,
  getuid: process.getuid,
  isExecutableFile,
  mkdir,
  mkdtemp,
  rm,
  spawnChrome: (executablePath, args, options) =>
    spawn(executablePath, args, {
      detached: options.detached,
      env: options.env,
      stdio: "ignore",
    }),
  fetch: globalThis.fetch,
  findAvailablePort,
  assertPortAvailable,
  signalProcess: (pid, signal) => process.kill(pid, signal),
  runTaskkill,
};

export type LocalBrowserLauncher = (
  options: LocalBrowserLaunchOptions,
  signal?: AbortSignal,
) => Promise<{ cdpUrl: string; close: () => Promise<void> }>;

export async function launchLocalBrowser(
  options: LocalBrowserLaunchOptions,
  signal?: AbortSignal,
): Promise<{ cdpUrl: string; close: () => Promise<void> }> {
  return await launchChrome(options, signal, defaultDependencies);
}

async function launchChrome(
  options: LocalBrowserLaunchOptions,
  signal: AbortSignal | undefined,
  dependencies: LocalBrowserLauncherDependencies,
): Promise<{ cdpUrl: string; close: () => Promise<void> }> {
  validateLocalBrowserOptions(options);
  throwIfAborted(signal);

  const chromePath = await findChromePath(options.executablePath, dependencies);
  const port = await resolveChromePort(options.port, dependencies);
  const { userDataDir, removeProfile } = await resolveChromeProfile(options, dependencies);

  let child: ChildProcess | undefined;
  let close: (() => Promise<void>) | undefined;
  try {
    throwIfAborted(signal);
    const args = localBrowserChromeFlags(
      options,
      port,
      userDataDir,
      shouldDisableSandbox(options, dependencies),
    );
    child = dependencies.spawnChrome(chromePath, args, {
      detached: dependencies.platform !== "win32",
      env: dependencies.env,
    });
    const monitor = monitorChromeProcess(child);
    close = memoizedChromeClose(child, monitor, userDataDir, removeProfile, dependencies);
    await abortable(monitor.spawned, signal);

    const cdpUrl = `http://127.0.0.1:${port}`;
    await waitForChrome(cdpUrl, monitor, signal, dependencies.fetch);
    return { cdpUrl, close };
  } catch (error) {
    if (close) {
      try {
        await close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Chrome launch failed and browser cleanup also failed",
          { cause: error },
        );
      }
    } else if (removeProfile) {
      try {
        await dependencies.rm(userDataDir, { force: true, recursive: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Chrome launch failed and profile cleanup also failed",
          { cause: error },
        );
      }
    }
    throw error;
  }
}

async function resolveChromeProfile(
  options: LocalBrowserLaunchOptions,
  dependencies: Pick<LocalBrowserLauncherDependencies, "mkdir" | "mkdtemp">,
): Promise<{ userDataDir: string; removeProfile: boolean }> {
  if (options.userDataDir !== undefined && options.userDataDir !== "") {
    await dependencies.mkdir(options.userDataDir, { recursive: true, mode: 0o700 });
    return { userDataDir: options.userDataDir, removeProfile: false };
  }
  const userDataDir = await dependencies.mkdtemp(path.join(tmpdir(), "stagehand-chrome-"));
  return {
    userDataDir,
    removeProfile: options.preserveUserDataDir !== true,
  };
}

export function localBrowserChromeFlags(
  options: LocalBrowserLaunchOptions,
  port: number,
  userDataDir: string,
  disableSandbox: boolean,
): string[] {
  const ignoredDefaultArgs = options.ignoreDefaultArgs;
  const ignoredFlags = new Set(Array.isArray(ignoredDefaultArgs) ? ignoredDefaultArgs : []);
  const includeDefaults = ignoredDefaultArgs !== true;
  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const windowSizeFlag = `--window-size=${viewport.width},${viewport.height}`;

  return [
    ...(includeDefaults ? selectedChromeFlags(DEFAULT_CHROME_FLAGS, ignoredFlags) : []),
    ...(options.viewport !== undefined || (includeDefaults && !ignoredFlags.has(windowSizeFlag))
      ? [windowSizeFlag]
      : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...(options.headless === true ? ["--headless"] : []),
    ...(options.devtools ? ["--auto-open-devtools-for-tabs"] : []),
    ...(disableSandbox ? ["--no-sandbox"] : []),
    ...(options.proxy ? [`--proxy-server=${options.proxy.server}`] : []),
    ...(options.proxy?.bypass ? [`--proxy-bypass-list=${options.proxy.bypass}`] : []),
    ...(options.locale ? [`--lang=${options.locale}`] : []),
    ...(options.deviceScaleFactor === undefined
      ? []
      : [`--force-device-scale-factor=${options.deviceScaleFactor}`]),
    ...(options.hasTouch === true ? ["--touch-events=enabled"] : []),
    ...(options.ignoreHTTPSErrors === true ? ["--ignore-certificate-errors"] : []),
    ...(options.args ?? []),
    "about:blank",
  ];
}

function selectedChromeFlags(
  flags: readonly string[],
  ignoredFlags: ReadonlySet<string>,
): string[] {
  return flags.filter((flag) => !ignoredFlags.has(flag));
}

function validateLocalBrowserOptions(options: LocalBrowserLaunchOptions): void {
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535)
  ) {
    throw new Error("Chrome port must be an integer between 1 and 65535");
  }
  if (
    options.viewport !== undefined &&
    (!Number.isInteger(options.viewport.width) ||
      !Number.isInteger(options.viewport.height) ||
      options.viewport.width <= 0 ||
      options.viewport.height <= 0)
  ) {
    throw new Error("Chrome viewport dimensions must be positive integers");
  }
  if (
    options.deviceScaleFactor !== undefined &&
    (!Number.isFinite(options.deviceScaleFactor) || options.deviceScaleFactor <= 0)
  ) {
    throw new Error("Chrome device scale factor must be positive and finite");
  }
  if (options.proxy !== undefined) {
    if (options.proxy.server.length === 0) {
      throw new Error("Chrome proxy server is required");
    }
    if (options.proxy.username !== undefined || options.proxy.password !== undefined) {
      throw new Error("Authenticated local browser proxies are not supported yet");
    }
  }
}

async function findChromePath(
  explicitPath: string | undefined,
  dependencies: Pick<LocalBrowserLauncherDependencies, "platform" | "env" | "isExecutableFile">,
): Promise<string> {
  if (explicitPath !== undefined) {
    if (await dependencies.isExecutableFile(explicitPath)) return explicitPath;
    throw new Error(`Chrome executable ${JSON.stringify(explicitPath)} does not exist`);
  }

  const configuredPath = dependencies.env.CHROME_PATH;
  if (configuredPath && (await dependencies.isExecutableFile(configuredPath))) {
    return configuredPath;
  }

  const candidates = chromeCandidates(dependencies.platform, dependencies.env);
  for (const candidate of candidates) {
    if (await dependencies.isExecutableFile(candidate)) return candidate;
  }
  throw new Error("Chrome installation not found; set CHROME_PATH");
}

function chromeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (platform === "win32") {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]].filter(
      (root): root is string => Boolean(root),
    );
    const suffixes = [
      ["Google", "Chrome SxS", "Application", "chrome.exe"],
      ["Google", "Chrome", "Application", "chrome.exe"],
    ];
    return roots.flatMap((root) => suffixes.map((suffix) => path.win32.join(root, ...suffix)));
  }
  if (platform === "linux") {
    const directories = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
    const names = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium"];
    return names.flatMap((name) => directories.map((directory) => path.join(directory, name)));
  }
  throw new Error(`Chrome launching is not supported on ${platform}`);
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    if (process.platform !== "win32") await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveChromePort(
  requestedPort: number | undefined,
  dependencies: Pick<LocalBrowserLauncherDependencies, "assertPortAvailable" | "findAvailablePort">,
): Promise<number> {
  if (requestedPort === undefined) return await dependencies.findAvailablePort();
  await dependencies.assertPortAvailable(requestedPort);
  return requestedPort;
}

async function findAvailablePort(): Promise<number> {
  return await inspectPort(0);
}

async function assertPortAvailable(port: number): Promise<void> {
  try {
    await inspectPort(port);
  } catch (error) {
    throw new Error(`Chrome debugging port ${port} is already in use`, { cause: error });
  }
}

async function inspectPort(port: number): Promise<number> {
  const server = createServer();
  server.unref();
  try {
    return await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "object" && address !== null) resolve(address.port);
        else reject(new Error("Failed to resolve Chrome debugging port"));
      });
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function shouldDisableSandbox(
  options: LocalBrowserLaunchOptions,
  dependencies: Pick<LocalBrowserLauncherDependencies, "platform" | "env" | "getuid">,
): boolean {
  return (
    Boolean(dependencies.env.CI) ||
    options.chromiumSandbox === false ||
    (dependencies.platform === "linux" && dependencies.getuid?.() === 0)
  );
}

function monitorChromeProcess(child: ChildProcess): ChromeProcessMonitor {
  let currentExit: ChromeProcessExit | undefined;
  let resolveSpawned!: () => void;
  let rejectSpawned!: (error: Error) => void;
  let resolveExited!: (exit: ChromeProcessExit) => void;
  const spawned = new Promise<void>((resolve, reject) => {
    resolveSpawned = resolve;
    rejectSpawned = reject;
  });
  const exited = new Promise<ChromeProcessExit>((resolve) => {
    resolveExited = resolve;
  });

  child.once("spawn", resolveSpawned);
  child.once("error", (error) => {
    rejectSpawned(error);
    if (!currentExit) {
      currentExit = { code: null, signal: null, error };
      resolveExited(currentExit);
    }
  });
  child.once("exit", (code, signal) => {
    if (!currentExit) {
      currentExit = { code, signal };
      resolveExited(currentExit);
    }
  });

  if (child.exitCode !== null || child.signalCode !== null) {
    currentExit = { code: child.exitCode, signal: child.signalCode };
    resolveSpawned();
    resolveExited(currentExit);
  }

  return { spawned, exited, currentExit: () => currentExit };
}

async function waitForChrome(
  cdpUrl: string,
  monitor: ChromeProcessMonitor,
  signal: AbortSignal | undefined,
  fetchImplementation: typeof globalThis.fetch,
): Promise<void> {
  while (true) {
    throwIfAborted(signal);
    const exited = monitor.currentExit();
    if (exited) throw chromeExitedBeforeReadyError(exited);

    const outcome = await abortable(
      Promise.race([
        chromeDebuggingReady(cdpUrl, signal, fetchImplementation).then((ready) => ({
          kind: "ready" as const,
          ready,
        })),
        monitor.exited.then((exit) => ({ kind: "exit" as const, exit })),
      ]),
      signal,
    );
    if (outcome.kind === "exit") throw chromeExitedBeforeReadyError(outcome.exit);
    if (outcome.ready) {
      const exitAfterReadiness = monitor.currentExit();
      if (exitAfterReadiness) throw chromeExitedBeforeReadyError(exitAfterReadiness);
      return;
    }

    await abortable(
      Promise.race([
        abortableDelay(CHROME_POLL_INTERVAL_MS, signal),
        monitor.exited.then((exit) => {
          throw chromeExitedBeforeReadyError(exit);
        }),
      ]),
      signal,
    );
  }
}

async function chromeDebuggingReady(
  cdpUrl: string,
  signal: AbortSignal | undefined,
  fetchImplementation: typeof globalThis.fetch,
): Promise<boolean> {
  const requestController = new AbortController();
  const timeoutId = setTimeout(() => requestController.abort(), CHROME_REQUEST_TIMEOUT_MS);
  const requestSignal = signal
    ? AbortSignal.any([signal, requestController.signal])
    : requestController.signal;
  try {
    const response = await fetchImplementation(`${cdpUrl.replace(/\/$/, "")}/json/version`, {
      signal: requestSignal,
    });
    if (!response.ok) return false;
    const version: unknown = await response.json();
    return (
      typeof version === "object" &&
      version !== null &&
      "webSocketDebuggerUrl" in version &&
      typeof version.webSocketDebuggerUrl === "string" &&
      version.webSocketDebuggerUrl.trim().length > 0
    );
  } catch {
    throwIfAborted(signal);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function chromeExitedBeforeReadyError(exit: ChromeProcessExit): Error {
  if (exit.error) {
    return new Error(`Chrome exited before its debugging port was ready: ${exit.error.message}`, {
      cause: exit.error,
    });
  }
  const detail = exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? "unknown"}`;
  return new Error(`Chrome exited before its debugging port was ready with ${detail}`);
}

function memoizedChromeClose(
  child: ChildProcess,
  monitor: ChromeProcessMonitor,
  userDataDir: string,
  removeProfile: boolean,
  dependencies: LocalBrowserLauncherDependencies,
): () => Promise<void> {
  let closePromise: Promise<void> | undefined;
  return () => {
    closePromise ??= closeChrome(child, monitor, userDataDir, removeProfile, dependencies);
    return closePromise;
  };
}

async function closeChrome(
  child: ChildProcess,
  monitor: ChromeProcessMonitor,
  userDataDir: string,
  removeProfile: boolean,
  dependencies: LocalBrowserLauncherDependencies,
): Promise<void> {
  let processError: unknown;
  try {
    await closeChromeProcess(child, monitor, dependencies);
  } catch (error) {
    processError = error;
  }

  let profileError: unknown;
  if (removeProfile) {
    try {
      await dependencies.rm(userDataDir, { force: true, recursive: true });
    } catch (error) {
      profileError = error;
    }
  }

  if (processError && profileError) {
    throw new AggregateError(
      [processError, profileError],
      "Chrome termination and profile cleanup both failed",
    );
  }
  if (processError) throw processError;
  if (profileError) throw profileError;
}

async function closeChromeProcess(
  child: ChildProcess,
  monitor: ChromeProcessMonitor,
  dependencies: LocalBrowserLauncherDependencies,
): Promise<void> {
  if (monitor.currentExit()) return;
  const pid = child.pid;
  if (pid === undefined) return;

  try {
    await terminateChromeProcess(pid, false, dependencies);
  } catch (error) {
    if (!isFinishedProcessError(error)) throw error;
  }
  if (await waitForExit(monitor, CHROME_TERMINATION_TIMEOUT_MS)) return;

  try {
    await terminateChromeProcess(pid, true, dependencies);
  } catch (error) {
    if (!isFinishedProcessError(error)) throw error;
  }
  await monitor.exited;
}

async function terminateChromeProcess(
  pid: number,
  force: boolean,
  dependencies: Pick<
    LocalBrowserLauncherDependencies,
    "platform" | "runTaskkill" | "signalProcess"
  >,
): Promise<void> {
  if (dependencies.platform === "win32") {
    await dependencies.runTaskkill(pid, force);
    return;
  }
  dependencies.signalProcess(-pid, force ? "SIGKILL" : "SIGTERM");
}

async function waitForExit(monitor: ChromeProcessMonitor, timeoutMs: number): Promise<boolean> {
  if (monitor.currentExit()) return true;
  return await new Promise<boolean>((resolve) => {
    const timeoutId = setTimeout(() => resolve(false), timeoutMs);
    void monitor.exited.then(() => {
      clearTimeout(timeoutId);
      resolve(true);
    });
  });
}

function isFinishedProcessError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ESRCH" || error.code === 128)
  );
}

async function runTaskkill(pid: number, force: boolean): Promise<void> {
  const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
  const taskkill = spawn("taskkill", args, { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    taskkill.once("error", reject);
    taskkill.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          Object.assign(new Error(`taskkill exited with code ${code ?? "unknown"}`), { code }),
        );
    });
  });
}

/** @internal */
export function createLocalBrowserLauncherForTest(
  overrides: Partial<LocalBrowserLauncherDependencies>,
): LocalBrowserLauncher {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (options, signal) => await launchChrome(options, signal, dependencies);
}
