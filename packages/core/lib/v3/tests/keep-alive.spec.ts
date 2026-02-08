import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import Browserbase from "@browserbasehq/sdk";
import WebSocket from "ws";

type EnvKind = "LOCAL" | "BROWSERBASE";
type ScenarioKind = "unhandled" | "close" | "sigterm" | "sigint";

type ScenarioConfig = {
  env: EnvKind;
  keepAlive: boolean;
  disableAPI: boolean;
  kind: ScenarioKind;
  debug: boolean;
  viewMs: number;
};

type ChildInfo = {
  connectURL: string;
  sessionId: string | null;
};

type ChildLogs = {
  stdout: string[];
  stderr: string[];
};

const coreDir = path.resolve(__dirname, "../../..");
const childScriptPath = path.resolve(__dirname, "keep-alive.child.ts");

const DEBUG = process.env.KEEP_ALIVE_DEBUG === "1";
const VIEW_MS = Number(process.env.KEEP_ALIVE_VIEW_MS ?? "0");
const LOCAL_TIMEOUT_MS = Number(
  process.env.KEEP_ALIVE_LOCAL_TIMEOUT_MS ?? "8000",
);
const BB_TIMEOUT_MS = Number(process.env.KEEP_ALIVE_BB_TIMEOUT_MS ?? "30000");
const STAY_OPEN_MS = Number(process.env.KEEP_ALIVE_STAY_OPEN_MS ?? "6000");
const ACTION_EXIT_TIMEOUT_MS = Number(
  process.env.KEEP_ALIVE_ACTION_EXIT_TIMEOUT_MS ?? "3000",
);

function debugLog(message: string): void {
  if (DEBUG) {
    console.log(message);
  }
}

function parseChildInfo(line: string): ChildInfo | null {
  const prefix = "__KEEPALIVE__";
  if (!line.startsWith(prefix)) return null;
  try {
    return JSON.parse(line.slice(prefix.length)) as ChildInfo;
  } catch {
    return null;
  }
}

async function runScenario(config: ScenarioConfig): Promise<{
  info: ChildInfo;
  child: ReturnType<typeof spawn>;
  logs: ChildLogs;
}> {
  const apiKey = process.env.BROWSERBASE_API_KEY ?? process.env.BB_API_KEY;
  const projectId =
    process.env.BROWSERBASE_PROJECT_ID ?? process.env.BB_PROJECT_ID;
  const payload = {
    env: config.env,
    keepAlive: config.keepAlive,
    disableAPI: config.disableAPI,
    scenario: config.kind,
    apiKey,
    projectId,
    debug: config.debug,
    viewMs: config.viewMs,
  };
  const encoded = `cfg:${Buffer.from(JSON.stringify(payload)).toString("base64")}`;

  const child = spawn(
    process.execPath,
    ["--import", "tsx", childScriptPath, encoded],
    {
      cwd: coreDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const logs: ChildLogs = { stdout: [], stderr: [] };
  let buffer = "";
  let stderr = "";
  let resolved = false;

  const infoPromise = new Promise<ChildInfo>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      const details = stderr.trim();
      const suffix = details
        ? `\nChild stderr:\n${details}`
        : "\nChild did not emit keepAlive info.";
      reject(new Error(`Child timed out waiting for info.${suffix}`));
    }, 15_000);

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        const parsed = parseChildInfo(line);
        if (parsed && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(parsed);
        } else if (line.length > 0) {
          logs.stdout.push(line);
          debugLog(`[keep-alive-child] ${line}`);
        }
        idx = buffer.indexOf("\n");
      }
    });

    child.on("exit", (code, signal) => {
      if (resolved) return;
      clearTimeout(timeout);
      const details = stderr.trim();
      const suffix = details
        ? `\nChild stderr:\n${details}`
        : "\nChild exited without emitting keepAlive info.";
      reject(
        new Error(
          `Child exited (code=${code ?? "null"}, signal=${signal ?? "null"})${suffix}`,
        ),
      );
    });

    child.on("error", (error) => {
      if (resolved) return;
      clearTimeout(timeout);
      reject(error);
    });
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      logs.stderr.push(trimmed);
      debugLog(`[keep-alive-child] ${trimmed}`);
    }
  });

  const info = await infoPromise;
  return { info, child, logs };
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.killed) return;
  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForChildExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.killed) return true;
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function isLocalBrowserAlive(connectURL: string): Promise<boolean> {
  let port = "";
  try {
    port = new URL(connectURL).port;
  } catch {
    return false;
  }
  if (!port) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function closeLocalBrowser(connectURL: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(connectURL);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve();
    }, 2000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    });
    ws.on("error", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function isBrowserbaseSessionAlive(sessionId: string): Promise<boolean> {
  const apiKey = process.env.BROWSERBASE_API_KEY ?? process.env.BB_API_KEY;
  if (!apiKey) return false;

  const bb = new Browserbase({ apiKey });
  try {
    const snapshot = (await bb.sessions.retrieve(sessionId)) as {
      status?: string;
    };
    if (DEBUG) {
      const status = snapshot?.status ?? "<missing>";
      debugLog(`[keep-alive] session ${sessionId} status=${status}`);
    }
    return snapshot?.status === "RUNNING";
  } catch (error) {
    debugLog(
      `[keep-alive] session ${sessionId} retrieve failed: ${String(error)}`,
    );
    return false;
  }
}

async function endBrowserbaseSession(sessionId: string): Promise<void> {
  const apiKey = process.env.BROWSERBASE_API_KEY ?? process.env.BB_API_KEY;
  const projectId =
    process.env.BROWSERBASE_PROJECT_ID ?? process.env.BB_PROJECT_ID;
  if (!apiKey || !projectId) return;
  const bb = new Browserbase({ apiKey });
  try {
    await bb.sessions.update(sessionId, {
      status: "REQUEST_RELEASE",
      projectId,
    });
  } catch {
    // best-effort cleanup
  }
}

async function assertStaysOpen(
  check: () => Promise<boolean>,
  durationMs: number,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const alive = await check();
    if (!alive) {
      throw new Error(
        `Expected browser to stay open for ${durationMs}ms (closed early).`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function assertBrowserState(
  env: EnvKind,
  info: ChildInfo,
  shouldStayOpen: boolean,
): Promise<void> {
  if (env === "LOCAL") {
    if (shouldStayOpen) {
      await assertStaysOpen(
        () => isLocalBrowserAlive(info.connectURL),
        STAY_OPEN_MS,
      );
    } else {
      await expect
        .poll(() => isLocalBrowserAlive(info.connectURL), {
          timeout: LOCAL_TIMEOUT_MS,
        })
        .toBe(false);
    }
    if (shouldStayOpen) {
      await closeLocalBrowser(info.connectURL);
    }
    return;
  }

  if (!info.sessionId) {
    throw new Error("Browserbase sessionId missing");
  }

  if (shouldStayOpen) {
    await assertStaysOpen(
      () => isBrowserbaseSessionAlive(info.sessionId!),
      STAY_OPEN_MS,
      1000,
    );
  } else {
    await expect
      .poll(() => isBrowserbaseSessionAlive(info.sessionId!), {
        timeout: BB_TIMEOUT_MS,
        intervals: [1000, 2000, 5000],
      })
      .toBe(false);
  }

  if (shouldStayOpen) {
    await endBrowserbaseSession(info.sessionId);
  }
}

function dumpLogs(logs: ChildLogs): void {
  if (logs.stdout.length > 0) {
    console.log("[keep-alive] child stdout:");
    for (const line of logs.stdout) {
      console.log(`  ${line}`);
    }
  }
  if (logs.stderr.length > 0) {
    console.log("[keep-alive] child stderr:");
    for (const line of logs.stderr) {
      console.log(`  ${line}`);
    }
  }
}

test.describe.parallel("keepAlive behavior", () => {
  const testEnv = (process.env.TEST_ENV ?? "LOCAL").toUpperCase();
  if (testEnv !== "LOCAL" && testEnv !== "BROWSERBASE") {
    throw new Error("TEST_ENV must be LOCAL or BROWSERBASE");
  }

  const hasBrowserbaseCreds = Boolean(
    (process.env.BROWSERBASE_API_KEY ?? process.env.BB_API_KEY) &&
      (process.env.BROWSERBASE_PROJECT_ID ?? process.env.BB_PROJECT_ID),
  );

  const cases: Array<{ kind: ScenarioKind; label: string }> = [
    { kind: "unhandled", label: "unhandled rejection" },
    { kind: "close", label: "stagehand.close()" },
    { kind: "sigterm", label: "SIGTERM" },
    { kind: "sigint", label: "SIGINT" },
  ];

  const environments: Array<{
    env: EnvKind;
    label: string;
    disableAPI: boolean;
    requiresBrowserbase: boolean;
  }> =
    testEnv === "BROWSERBASE"
      ? [
          {
            env: "BROWSERBASE",
            label: "bb direct ws",
            disableAPI: true,
            requiresBrowserbase: true,
          },
          {
            env: "BROWSERBASE",
            label: "bb via api",
            disableAPI: false,
            requiresBrowserbase: true,
          },
        ]
      : [
          {
            env: "LOCAL",
            label: "local",
            disableAPI: false,
            requiresBrowserbase: false,
          },
        ];

  for (const keepAlive of [true, false]) {
    test.describe(`keepAlive=${keepAlive}`, () => {
      for (const envConfig of environments) {
        test.describe(envConfig.label, () => {
          for (const testCase of cases) {
            test(testCase.label, async () => {
              if (envConfig.requiresBrowserbase) {
                test.skip(
                  !hasBrowserbaseCreds,
                  "Browserbase credentials required",
                );
              }

              const { info, child, logs } = await runScenario({
                env: envConfig.env,
                keepAlive,
                disableAPI: envConfig.disableAPI,
                kind: testCase.kind,
                debug: DEBUG,
                viewMs: VIEW_MS,
              });

              if (testCase.kind === "sigterm") {
                child.kill("SIGTERM");
              } else if (testCase.kind === "sigint") {
                child.kill("SIGINT");
              }

              try {
                if (
                  testCase.kind === "close" ||
                  testCase.kind === "unhandled"
                ) {
                  await waitForChildExit(child, ACTION_EXIT_TIMEOUT_MS);
                } else if (
                  testCase.kind === "sigterm" ||
                  testCase.kind === "sigint"
                ) {
                  await waitForChildExit(child, ACTION_EXIT_TIMEOUT_MS);
                }
                await assertBrowserState(envConfig.env, info, keepAlive);
              } catch (error) {
                dumpLogs(logs);
                throw error;
              } finally {
                await stopChild(child);
              }
            });
          }
        });
      }
    });
  }
});
