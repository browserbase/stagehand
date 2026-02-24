import { test } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import Browserbase from "@browserbasehq/sdk";
import WebSocket from "ws";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { getPackageRootDir } from "../../lib/v3/runtimePaths.js";

export type EnvKind = "LOCAL" | "BROWSERBASE";
export type ScenarioKind = "unhandled" | "close" | "sigterm" | "sigint";

export type KeepAliveCase = {
  title: string;
  env: EnvKind;
  envLabel: string;
  keepAlive: boolean;
  disableAPI: boolean;
  kind: ScenarioKind;
  requiresBrowserbase: boolean;
};

type ScenarioConfig = {
  env: EnvKind;
  keepAlive: boolean;
  disableAPI: boolean;
  kind: ScenarioKind;
  debug: boolean;
  viewMs: number;
  apiKey?: string;
  projectId?: string;
};

type ChildInfo = {
  connectURL: string;
  sessionId: string | null;
};

type ChildLogs = {
  stdout: string[];
  stderr: string[];
};

type CheckResult = {
  alive: boolean;
  status?: string;
};

type Outcome = {
  expected: "open" | "closed";
  actual: "open" | "closed";
  durationMs: number;
  lastStatus?: string;
};

const coreDir = getPackageRootDir();

const resolveChildRunner = (): { command: string; args: string[] } | null => {
  const distJsPath = `${coreDir}/dist/esm/tests/integration/keep-alive.child.js`;
  if (fs.existsSync(distJsPath)) {
    return { command: process.execPath, args: [distJsPath] };
  }

  return null;
};

const childRunner = resolveChildRunner();

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
const LOCAL_INFO_TIMEOUT_MS = Number(
  process.env.KEEP_ALIVE_LOCAL_INFO_TIMEOUT_MS ?? "15000",
);
const BB_INFO_TIMEOUT_MS = Number(
  process.env.KEEP_ALIVE_BB_INFO_TIMEOUT_MS ??
    (process.env.CI ? "45000" : "30000"),
);

const getInfoTimeoutMs = (env: EnvKind): number =>
  env === "BROWSERBASE" ? BB_INFO_TIMEOUT_MS : LOCAL_INFO_TIMEOUT_MS;

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
  const payload = {
    env: config.env,
    keepAlive: config.keepAlive,
    disableAPI: config.disableAPI,
    scenario: config.kind,
    apiKey: config.apiKey,
    projectId: config.projectId,
    debug: config.debug,
    viewMs: config.viewMs,
  };
  const encoded = `cfg:${Buffer.from(JSON.stringify(payload)).toString("base64")}`;

  if (!childRunner) {
    throw new Error(
      "keep-alive child script not found at dist/esm/tests/integration/keep-alive.child.js",
    );
  }

  const child = spawn(childRunner.command, [...childRunner.args, encoded], {
    cwd: coreDir,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: ChildLogs = { stdout: [], stderr: [] };
  let buffer = "";
  let stderr = "";
  let resolved = false;
  const infoTimeoutMs = getInfoTimeoutMs(config.env);

  const infoPromise = new Promise<ChildInfo>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      const stdoutDetails =
        logs.stdout.length > 0
          ? `\nChild stdout:\n${logs.stdout.join("\n")}`
          : "";
      const details = stderr.trim();
      const suffix = details
        ? `\nChild stderr:\n${details}`
        : "\nChild did not emit keepAlive info.";
      reject(
        new Error(
          `Child timed out waiting for info after ${infoTimeoutMs}ms (env=${config.env}, keepAlive=${config.keepAlive}, disableAPI=${config.disableAPI}, scenario=${config.kind}).${suffix}${stdoutDetails}`,
        ),
      );
    }, infoTimeoutMs);

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
      const stdoutDetails =
        logs.stdout.length > 0
          ? `\nChild stdout:\n${logs.stdout.join("\n")}`
          : "";
      const details = stderr.trim();
      const suffix = details
        ? `\nChild stderr:\n${details}`
        : "\nChild exited without emitting keepAlive info.";
      reject(
        new Error(
          `Child exited (code=${code ?? "null"}, signal=${signal ?? "null"}) before emitting keepAlive info (env=${config.env}, keepAlive=${config.keepAlive}, disableAPI=${config.disableAPI}, scenario=${config.kind}).${suffix}${stdoutDetails}`,
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
  if (child.exitCode !== null) return;
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
): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function checkLocalAlive(connectURL: string): Promise<CheckResult> {
  let port = "";
  try {
    port = new URL(connectURL).port;
  } catch {
    return { alive: false, status: "INVALID_URL" };
  }
  if (!port) return { alive: false, status: "MISSING_PORT" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { alive: false, status: `HTTP_${resp.status}` };
    }
    const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
    const ws = json?.webSocketDebuggerUrl;
    if (!ws) {
      return { alive: false, status: "MISSING_WS" };
    }
    if (ws !== connectURL) {
      return { alive: false, status: "WS_MISMATCH" };
    }
    return { alive: true, status: "MATCH" };
  } catch {
    return { alive: false, status: "FETCH_ERROR" };
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

async function checkBrowserbaseAlive(
  sessionId: string,
  apiKey?: string,
): Promise<CheckResult> {
  if (!apiKey) return { alive: false, status: "NO_API_KEY" };

  const bb = new Browserbase({ apiKey });
  try {
    const snapshot = (await bb.sessions.retrieve(sessionId)) as {
      status?: string;
    };
    if (DEBUG) {
      const status = snapshot?.status ?? "<missing>";
      debugLog(`[keep-alive] session ${sessionId} status=${status}`);
    }
    const status = snapshot?.status;
    return { alive: status === "RUNNING", status };
  } catch (error) {
    debugLog(
      `[keep-alive] session ${sessionId} retrieve failed: ${String(error)}`,
    );
    return { alive: false, status: "RETRIEVE_FAILED" };
  }
}

async function endBrowserbaseSession(
  sessionId: string,
  apiKey?: string,
  projectId?: string,
): Promise<void> {
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
  check: () => Promise<CheckResult>,
  durationMs: number,
  intervalMs = 500,
): Promise<{ durationMs: number; lastStatus?: string }> {
  const start = Date.now();
  const deadline = start + durationMs;
  let lastStatus: string | undefined;
  while (Date.now() < deadline) {
    const result = await check();
    lastStatus = result.status ?? lastStatus;
    if (!result.alive) {
      const elapsed = Date.now() - start;
      const status = lastStatus ? ` (last status ${lastStatus})` : "";
      throw new Error(
        `Browser closed after ${elapsed}ms (expected ${durationMs}ms)${status}.`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { durationMs: Date.now() - start, lastStatus };
}

async function waitForClosed(
  check: () => Promise<CheckResult>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<{ durationMs: number; lastStatus?: string }> {
  const start = Date.now();
  let lastStatus: string | undefined;
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    lastStatus = result.status ?? lastStatus;
    if (!result.alive) {
      return { durationMs: Date.now() - start, lastStatus };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const status = lastStatus ? ` (last status ${lastStatus})` : "";
  throw new Error(`Browser still alive after ${timeoutMs}ms${status}.`);
}

async function assertBrowserState(
  env: EnvKind,
  info: ChildInfo,
  shouldStayOpen: boolean,
  apiKey?: string,
  projectId?: string,
): Promise<Outcome> {
  const expected: Outcome["expected"] = shouldStayOpen ? "open" : "closed";
  if (env === "LOCAL") {
    if (shouldStayOpen) {
      const result = await assertStaysOpen(
        () => checkLocalAlive(info.connectURL),
        STAY_OPEN_MS,
      );
      const outcome: Outcome = {
        expected,
        actual: "open",
        durationMs: result.durationMs,
        lastStatus: result.lastStatus,
      };
      await closeLocalBrowser(info.connectURL);
      return outcome;
    }

    const result = await waitForClosed(
      () => checkLocalAlive(info.connectURL),
      LOCAL_TIMEOUT_MS,
    );
    return {
      expected,
      actual: "closed",
      durationMs: result.durationMs,
      lastStatus: result.lastStatus,
    };
  }

  if (!info.sessionId) {
    throw new Error("Browserbase sessionId missing");
  }

  if (shouldStayOpen) {
    const result = await assertStaysOpen(
      () => checkBrowserbaseAlive(info.sessionId!, apiKey),
      STAY_OPEN_MS,
      1000,
    );
    const outcome: Outcome = {
      expected,
      actual: "open",
      durationMs: result.durationMs,
      lastStatus: result.lastStatus,
    };
    await endBrowserbaseSession(info.sessionId, apiKey, projectId);
    return outcome;
  }

  const result = await waitForClosed(
    () => checkBrowserbaseAlive(info.sessionId!, apiKey),
    BB_TIMEOUT_MS,
    1000,
  );
  return {
    expected,
    actual: "closed",
    durationMs: result.durationMs,
    lastStatus: result.lastStatus,
  };
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

function logCaseResult(
  label: string,
  envLabel: string,
  keepAlive: boolean,
  outcome?: Outcome,
  error?: Error,
): void {
  const prefix = `[keep-alive] ${envLabel} keepAlive=${keepAlive} ${label}`;
  if (error) {
    console.log(`${prefix} FAIL: ${error.message}`);
    return;
  }
  if (!outcome) {
    console.log(`${prefix} FAIL: missing outcome`);
    return;
  }
  const status =
    outcome.lastStatus !== undefined
      ? ` (last status ${outcome.lastStatus})`
      : "";
  if (outcome.actual === "open") {
    console.log(
      `${prefix} PASS: stayed open for ${outcome.durationMs}ms${status}`,
    );
  } else {
    console.log(
      `${prefix} PASS: closed after ${outcome.durationMs}ms${status}`,
    );
  }
}

export function getKeepAliveEnvConfig(): {
  testEnv: EnvKind;
  apiKey?: string;
  projectId?: string;
  hasBrowserbaseCreds: boolean;
} {
  const testEnv = v3DynamicTestConfig.env;
  const apiKey =
    testEnv === "BROWSERBASE"
      ? (v3DynamicTestConfig.apiKey as string | undefined)
      : undefined;
  const projectId =
    testEnv === "BROWSERBASE"
      ? (v3DynamicTestConfig.projectId as string | undefined)
      : undefined;
  const hasBrowserbaseCreds = Boolean(apiKey && projectId);
  return { testEnv, apiKey, projectId, hasBrowserbaseCreds };
}

export function buildKeepAliveCases(testEnv: EnvKind): KeepAliveCase[] {
  const scenarios: Array<{ kind: ScenarioKind; label: string }> = [
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

  const cases: KeepAliveCase[] = [];
  for (const keepAlive of [true, false]) {
    for (const envConfig of environments) {
      for (const scenario of scenarios) {
        const expectation = keepAlive ? "expect open" : "expect closed";
        cases.push({
          title: `${envConfig.label} keepAlive=${keepAlive} ${scenario.label} (${expectation})`,
          env: envConfig.env,
          envLabel: envConfig.label,
          keepAlive,
          disableAPI: envConfig.disableAPI,
          kind: scenario.kind,
          requiresBrowserbase: envConfig.requiresBrowserbase,
        });
      }
    }
  }
  return cases;
}

export async function runKeepAliveCase(
  testCase: KeepAliveCase,
  envConfig: {
    apiKey?: string;
    projectId?: string;
  },
): Promise<void> {
  let info: ChildInfo | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let logs: ChildLogs | undefined;
  try {
    ({ info, child, logs } = await runScenario({
      env: testCase.env,
      keepAlive: testCase.keepAlive,
      disableAPI: testCase.disableAPI,
      kind: testCase.kind,
      debug: DEBUG,
      viewMs: VIEW_MS,
      apiKey: envConfig.apiKey,
      projectId: envConfig.projectId,
    }));
  } catch (error) {
    logCaseResult(
      testCase.title,
      testCase.envLabel,
      testCase.keepAlive,
      undefined,
      error as Error,
    );
    throw error;
  }

  if (testCase.kind === "sigterm") {
    child.kill("SIGTERM");
  } else if (testCase.kind === "sigint") {
    child.kill("SIGINT");
  }

  let outcome: Outcome | undefined;
  let failure: Error | undefined;
  try {
    if (
      testCase.kind === "close" ||
      testCase.kind === "unhandled" ||
      testCase.kind === "sigterm" ||
      testCase.kind === "sigint"
    ) {
      await waitForChildExit(child, ACTION_EXIT_TIMEOUT_MS);
    }
    outcome = await assertBrowserState(
      testCase.env,
      info,
      testCase.keepAlive,
      envConfig.apiKey,
      envConfig.projectId,
    );
  } catch (error) {
    failure = error as Error;
    if (logs) {
      dumpLogs(logs);
    }
    throw error;
  } finally {
    logCaseResult(
      testCase.title,
      testCase.envLabel,
      testCase.keepAlive,
      outcome,
      failure,
    );
    await stopChild(child);
    if (testCase.env === "LOCAL" && info.connectURL) {
      await closeLocalBrowser(info.connectURL);
    }
    if (testCase.env === "BROWSERBASE" && info.sessionId) {
      await endBrowserbaseSession(
        info.sessionId,
        envConfig.apiKey,
        envConfig.projectId,
      );
    }
  }
}

test.describe.parallel("keepAlive behavior", () => {
  const { testEnv, apiKey, projectId, hasBrowserbaseCreds } =
    getKeepAliveEnvConfig();
  const cases = buildKeepAliveCases(testEnv);

  for (const testCase of cases) {
    test(testCase.title, async () => {
      if (testCase.requiresBrowserbase) {
        test.skip(!hasBrowserbaseCreds, "Browserbase credentials required");
      }

      await runKeepAliveCase(testCase, { apiKey, projectId });
    });
  }
});
