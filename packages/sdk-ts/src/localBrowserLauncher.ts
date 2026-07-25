import type { BrowserSource } from "./clientSchemas.js";

export type LocalBrowserLaunchOptions = Omit<Extract<BrowserSource, { type: "local" }>, "type">;

export type LocalBrowserProcess = {
  exitCode: number | null;
  pid?: number;
  kill(signal?: string): boolean;
  once(event: "error", listener: (error: Error) => void): void;
  once(event: "exit", listener: () => void): void;
};

export type LocalBrowserNodeRuntime = {
  access(path: string): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  rm(path: string, options: { force: boolean; recursive: boolean }): Promise<void>;
  join(...parts: string[]): string;
  delimiter: string;
  tmpdir(): string;
  env: Record<string, string | undefined>;
  platform: string;
  kill(pid: number, signal: string): void;
  spawn(
    executablePath: string,
    args: string[],
    options: {
      detached: boolean;
      env: Record<string, string | undefined>;
      stdio: "ignore";
    },
  ): LocalBrowserProcess;
};

type LocalBrowserLauncherDependencies = {
  fetch?: typeof globalThis.fetch;
  loadExtension?: (cdpUrl: string, extensionPath: string) => Promise<void>;
  runtime?: LocalBrowserNodeRuntime;
};

const DEFAULT_CHROME_FLAGS = [
  "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,CalculateNativeWinOcclusion,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater,AutofillServerCommunication,PrivacySandboxSettings4,RenderDocument",
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
] as const;
const STAGEHAND_EXTENSION_PATH = new URL("../../server/dist", import.meta.url).pathname;

export async function launchLocalBrowser(
  options: LocalBrowserLaunchOptions,
  dependencies: LocalBrowserLauncherDependencies = {},
): Promise<{ cdpUrl: string; close: () => Promise<void> }> {
  if (options.proxy?.username !== undefined || options.proxy?.password !== undefined) {
    throw new Error("Authenticated local browser proxies are not implemented");
  }
  if (options.downloadsPath !== undefined || options.acceptDownloads !== undefined) {
    throw new Error("Local browser download options are not implemented");
  }

  const runtime = dependencies.runtime ?? (await loadNodeRuntime());
  const executablePath = options.executablePath ?? (await findChromeExecutable(runtime));
  const temporaryProfile = options.userDataDir === undefined;
  const userDataDir =
    options.userDataDir ??
    (await runtime.mkdtemp(runtime.join(runtime.tmpdir(), "stagehand-chrome-")));
  const requestedPort = options.port ?? 0;
  const flags = chromeFlags(options, runtime, userDataDir, requestedPort);
  let browserProcess: LocalBrowserProcess | undefined;
  let spawnError: Error | undefined;

  try {
    browserProcess = runtime.spawn(executablePath, flags, {
      detached: runtime.platform !== "win32",
      env: runtime.env,
      stdio: "ignore",
    });
    browserProcess.once("error", (error) => {
      spawnError = error;
    });
    const port = await waitForDebuggerPort(
      runtime,
      browserProcess,
      userDataDir,
      requestedPort,
      options.connectTimeoutMs ?? 30_000,
      () => spawnError,
      dependencies.fetch ?? globalThis.fetch,
    );
    let closed = false;

    const cdpUrl = `http://127.0.0.1:${port}`;
    await (dependencies.loadExtension ?? loadStagehandExtension)(cdpUrl, STAGEHAND_EXTENSION_PATH);

    return {
      cdpUrl,
      async close() {
        if (closed) return;
        closed = true;
        await stopBrowserProcess(runtime, browserProcess);
        if (temporaryProfile && options.preserveUserDataDir !== true) {
          await runtime.rm(userDataDir, { force: true, recursive: true });
        }
      },
    };
  } catch (error) {
    await stopBrowserProcess(runtime, browserProcess).catch(() => undefined);
    if (temporaryProfile && options.preserveUserDataDir !== true) {
      await runtime.rm(userDataDir, { force: true, recursive: true }).catch(() => undefined);
    }
    throw error;
  }
}

function chromeFlags(
  options: LocalBrowserLaunchOptions,
  runtime: LocalBrowserNodeRuntime,
  userDataDir: string,
  port: number,
): string[] {
  const defaultFlags =
    options.ignoreDefaultArgs === true
      ? []
      : DEFAULT_CHROME_FLAGS.filter(
          (flag) =>
            !Array.isArray(options.ignoreDefaultArgs) || !options.ignoreDefaultArgs.includes(flag),
        );
  const viewport = options.viewport ?? { width: 1280, height: 800 };

  return [
    ...defaultFlags,
    "--enable-unsafe-extension-debugging",
    "--remote-allow-origins=*",
    `--window-size=${viewport.width},${viewport.height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    ...(options.args ?? []),
    ...(options.headless === true ? ["--headless"] : []),
    ...(options.devtools === true ? ["--auto-open-devtools-for-tabs"] : []),
    ...(runtime.env.CI || options.chromiumSandbox === false ? ["--no-sandbox"] : []),
    ...(options.proxy ? [`--proxy-server=${options.proxy.server}`] : []),
    ...(options.proxy?.bypass ? [`--proxy-bypass-list=${options.proxy.bypass}`] : []),
    ...(options.locale ? [`--lang=${options.locale}`] : []),
    ...(options.deviceScaleFactor === undefined
      ? []
      : [`--force-device-scale-factor=${options.deviceScaleFactor}`]),
    ...(options.hasTouch === true ? ["--touch-events=enabled"] : []),
    ...(options.ignoreHTTPSErrors === true ? ["--ignore-certificate-errors"] : []),
    "about:blank",
  ];
}

export async function loadStagehandExtension(cdpUrl: string, extensionPath: string): Promise<void> {
  const response = await fetch(`${cdpUrl}/json/version`);
  if (!response.ok) {
    throw new Error(
      `Failed to discover Chrome's browser WebSocket: ${response.status} ${response.statusText}`,
    );
  }
  const version = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!version.webSocketDebuggerUrl) {
    throw new Error("Chrome's version endpoint did not include webSocketDebuggerUrl");
  }

  const socket = new WebSocket(version.webSocketDebuggerUrl);
  try {
    await waitForSocketOpen(socket, 10_000);
    await sendLoadUnpackedCommand(socket, extensionPath, 10_000);
  } finally {
    socket.close();
  }
}

async function waitForSocketOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out opening Chrome's WebSocket")),
      timeoutMs,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("Failed to open Chrome's WebSocket"));
      },
      { once: true },
    );
  });
}

async function sendLoadUnpackedCommand(
  socket: WebSocket,
  extensionPath: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const commandId = 1;
    const timeout = setTimeout(
      () => reject(new Error("Timed out loading the Stagehand extension")),
      timeoutMs,
    );

    socket.addEventListener(
      "message",
      (event) => {
        if (typeof event.data !== "string") return;
        const response = JSON.parse(event.data) as {
          id?: number;
          result?: { id?: string };
          error?: { message?: string };
        };
        if (response.id !== commandId) return;
        clearTimeout(timeout);

        if (response.error) {
          reject(new Error(response.error.message ?? "Chrome failed to load the extension"));
          return;
        }
        if (!response.result?.id) {
          reject(new Error("Chrome did not return the loaded Stagehand extension ID"));
          return;
        }
        resolve();
      },
      { once: false },
    );
    socket.send(
      JSON.stringify({
        id: commandId,
        method: "Extensions.loadUnpacked",
        params: { path: extensionPath },
      }),
    );
  });
}

async function waitForDebuggerPort(
  runtime: LocalBrowserNodeRuntime,
  browserProcess: LocalBrowserProcess,
  userDataDir: string,
  requestedPort: number,
  timeoutMs: number,
  getSpawnError: () => Error | undefined,
  fetchDebugger: typeof globalThis.fetch,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  const activePortPath = runtime.join(userDataDir, "DevToolsActivePort");
  let lastError: unknown;

  while (Date.now() < deadline) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw new Error(`Failed to launch Chrome: ${spawnError.message}`, { cause: spawnError });
    }
    if (browserProcess.exitCode !== null) {
      throw new Error(
        `Chrome exited before its debugger became ready (${browserProcess.exitCode})`,
      );
    }

    try {
      const port =
        requestedPort === 0
          ? parseDevToolsActivePort(await runtime.readFile(activePortPath, "utf8"))
          : requestedPort;
      const response = await fetchDebugger(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return port;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }

  throw new Error(
    `Timed out waiting ${timeoutMs}ms for Chrome's debugger${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
    { cause: lastError },
  );
}

function parseDevToolsActivePort(value: string): number {
  const port = Number.parseInt(value.split(/\r?\n/u, 1)[0] ?? "", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Chrome wrote an invalid DevToolsActivePort file");
  }
  return port;
}

async function stopBrowserProcess(
  runtime: LocalBrowserNodeRuntime,
  browserProcess: LocalBrowserProcess | undefined,
): Promise<void> {
  if (!browserProcess || browserProcess.exitCode !== null) return;
  const pid = browserProcess.pid;

  try {
    if (runtime.platform === "win32" || pid === undefined) {
      browserProcess.kill("SIGTERM");
    } else {
      runtime.kill(-pid, "SIGTERM");
    }
  } catch {
    browserProcess.kill("SIGTERM");
  }

  if (await waitForProcessExit(browserProcess, 3_000)) return;

  try {
    if (runtime.platform === "win32" || pid === undefined) {
      browserProcess.kill("SIGKILL");
    } else {
      runtime.kill(-pid, "SIGKILL");
    }
  } catch {
    browserProcess.kill("SIGKILL");
  }
  await waitForProcessExit(browserProcess, 3_000);
}

async function waitForProcessExit(
  browserProcess: LocalBrowserProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (browserProcess.exitCode !== null) return true;

  return await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    browserProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function findChromeExecutable(runtime: LocalBrowserNodeRuntime): Promise<string> {
  const configuredPaths = [runtime.env.CHROME_PATH, runtime.env.LIGHTHOUSE_CHROMIUM_PATH];
  const platformPaths =
    runtime.platform === "darwin"
      ? [
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ]
      : runtime.platform === "win32"
        ? [runtime.env.LOCALAPPDATA, runtime.env.PROGRAMFILES, runtime.env["PROGRAMFILES(X86)"]]
            .filter((root): root is string => Boolean(root))
            .map((root) => runtime.join(root, "Google", "Chrome", "Application", "chrome.exe"))
        : executableNamesFromPath(runtime, [
            "google-chrome-stable",
            "google-chrome",
            "chromium-browser",
            "chromium",
          ]);

  for (const candidate of [...configuredPaths, ...platformPaths]) {
    if (!candidate) continue;
    try {
      await runtime.access(candidate);
      return candidate;
    } catch {
      // Try the next known installation.
    }
  }
  throw new Error("Chrome installation not found; set CHROME_PATH or executablePath");
}

function executableNamesFromPath(runtime: LocalBrowserNodeRuntime, names: string[]): string[] {
  return (runtime.env.PATH ?? "")
    .split(runtime.delimiter)
    .filter(Boolean)
    .flatMap((directory) => names.map((name) => runtime.join(directory, name)));
}

async function loadNodeRuntime(): Promise<LocalBrowserNodeRuntime> {
  const childProcessModule = "node:child_process";
  const fileSystemModule = "node:fs/promises";
  const operatingSystemModule = "node:os";
  const pathModule = "node:path";
  const processModule = "node:process";
  const [childProcess, fileSystem, operatingSystem, path, processNamespace] = (await Promise.all([
    import(/* @vite-ignore */ childProcessModule),
    import(/* @vite-ignore */ fileSystemModule),
    import(/* @vite-ignore */ operatingSystemModule),
    import(/* @vite-ignore */ pathModule),
    import(/* @vite-ignore */ processModule),
  ])) as [
    {
      spawn: LocalBrowserNodeRuntime["spawn"];
    },
    Pick<LocalBrowserNodeRuntime, "access" | "mkdtemp" | "readFile" | "rm">,
    Pick<LocalBrowserNodeRuntime, "tmpdir">,
    Pick<LocalBrowserNodeRuntime, "delimiter" | "join">,
    {
      default: Pick<LocalBrowserNodeRuntime, "env" | "kill" | "platform">;
    },
  ];

  return {
    access: fileSystem.access,
    mkdtemp: fileSystem.mkdtemp,
    readFile: fileSystem.readFile,
    rm: fileSystem.rm,
    join: path.join,
    delimiter: path.delimiter,
    tmpdir: operatingSystem.tmpdir,
    env: processNamespace.default.env,
    platform: processNamespace.default.platform,
    kill: processNamespace.default.kill,
    spawn: childProcess.spawn,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
