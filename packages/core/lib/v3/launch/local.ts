import { launch, LaunchedChrome } from "chrome-launcher";
import { ConnectionTimeoutError } from "../types/public/sdkErrors";

interface LaunchLocalOptions {
  chromePath?: string;
  chromeFlags?: string[];
  headless?: boolean;
  userDataDir?: string;
  connectTimeoutMs?: number;
}

export async function launchLocalChrome(
  opts: LaunchLocalOptions,
): Promise<{ ws: string; chrome: LaunchedChrome }> {
  const headless = opts.headless ?? false;
  const chromeFlags = [
    headless ? "--headless=new" : undefined,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--site-per-process",
    ...(opts.chromeFlags ?? []),
  ].filter((f): f is string => typeof f === "string");

  const chrome = await launch({
    chromePath: opts.chromePath,
    chromeFlags,
    userDataDir: opts.userDataDir,
  });

  const ws = await waitForWebSocketDebuggerUrl(
    chrome.port,
    opts.connectTimeoutMs ?? 15_000,
  );

  return { ws, chrome };
}

async function waitForWebSocketDebuggerUrl(
  port: number,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastErrMsg = "";

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (resp.ok) {
        const json = (await resp.json()) as unknown;
        const url = (json as { webSocketDebuggerUrl?: string })
          .webSocketDebuggerUrl;
        if (typeof url === "string") return url;
      } else {
        lastErrMsg = `${resp.status} ${resp.statusText}`;
      }
    } catch (err) {
      lastErrMsg = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new ConnectionTimeoutError(
    `Timed out waiting for /json/version on port ${port}${
      lastErrMsg ? ` (last error: ${lastErrMsg})` : ""
    }`,
  );
}
