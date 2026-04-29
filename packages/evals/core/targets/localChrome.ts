import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

export function resolveLocalChromeExecutablePath(): string | undefined {
  const explicit = process.env.CHROME_PATH;
  if (explicit) {
    if (fs.existsSync(explicit)) {
      return explicit;
    }
    throw new Error(`CHROME_PATH does not exist: ${explicit}`);
  }

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Failed to allocate a local debugging port")),
        );
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForDebuggerUrl(
  port: number,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const payload = (await response.json()) as {
          webSocketDebuggerUrl?: string;
        };
        if (payload.webSocketDebuggerUrl) {
          return payload.webSocketDebuggerUrl;
        }
      } else {
        lastError = `${response.status} ${response.statusText}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `Timed out waiting for Chrome CDP endpoint on port ${port}${
      lastError ? ` (${lastError})` : ""
    }`,
  );
}

async function terminateChrome(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

export async function launchRunnerProvidedLocalChrome(): Promise<{
  wsUrl: string;
  cleanup: () => Promise<void>;
}> {
  const executablePath = resolveLocalChromeExecutablePath();
  if (!executablePath) {
    throw new Error(
      "Could not resolve a local Chrome executable. Set CHROME_PATH explicitly.",
    );
  }

  const port = await getFreePort();
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "stagehand-evals-"));
  const args = [
    "--headless=new",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--site-per-process",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ];

  const child = spawn(executablePath, args, {
    stdio: "ignore",
  });

  const cleanup = async () => {
    try {
      await terminateChrome(child);
    } finally {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  try {
    const wsUrl = await waitForDebuggerUrl(port, 15_000);

    return {
      wsUrl,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
