import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, expect, it } from "vitest";

// A browser the test owns and the facade only reaches by its CDP URL, the way
// a sandbox browser is reached. Needs a local Chrome (CHROME_PATH or the macOS
// default) and a built dist (pnpm run build). No model, site or credentials.
const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serverPath = fileURLToPath(new URL("../dist/facade/stdio-server.mjs", import.meta.url));

let chrome: ChildProcess | undefined;
let userDataDir: string;
let cdpUrl: string;

beforeAll(async () => {
  const port = await freePort();
  userDataDir = await mkdtemp(path.join(os.tmpdir(), "facade-cdp-attach-"));
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      // Stagehand loads its extension over CDP into a browser it did not launch.
      "--enable-unsafe-extension-debugging",
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  cdpUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (!(await browserAlive(cdpUrl))) {
    if (Date.now() > deadline) throw new Error("Chrome did not expose its CDP endpoint");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
});

afterAll(async () => {
  chrome?.kill("SIGKILL");
  await rm(userDataDir, { recursive: true, force: true });
});

it("drives a browser it attached to and leaves it running on close", async () => {
  const client = new Client({ name: "facade-cdp-attach-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...getDefaultEnvironment(), STAGEHAND_BROWSER: "cdp", STAGEHAND_CDP_URL: cdpUrl },
    }),
  );
  try {
    const result = await client.callTool({
      name: "run",
      arguments: {
        code: 'await page.goto("data:text/html,<title>attached</title>"); return await page.title();',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("attached");
    // The page opened in the test's own Chrome, not in a browser the facade launched.
    const targets = (await (await fetch(`${cdpUrl}/json/list`)).json()) as Array<{ title: string }>;
    expect(targets.map((target) => target.title)).toContain("attached");
  } finally {
    await client.close();
  }

  expect(await browserAlive(cdpUrl)).toBe(true);
}, 60_000);

async function browserAlive(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url}/json/version`)).ok;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}
