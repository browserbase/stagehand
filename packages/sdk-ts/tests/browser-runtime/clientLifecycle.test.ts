import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localBrowser, Stagehand } from "../../src/index.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";

const childPath = fileURLToPath(new URL("./fixtures/clientLifecycleChild.ts", import.meta.url));

function message(child: ChildProcess): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Child did not respond")), 30_000);
    const onMessage = (value: Record<string, unknown>) => finish(undefined, value);
    const onExit = (code: number | null) => finish(new Error(`Child exited: ${code}`));
    function finish(error?: Error, value?: Record<string, unknown>) {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(value!);
    }
    child.once("message", onMessage);
    child.once("exit", onExit);
  });
}

async function connect(url: string) {
  const socket = new WebSocket(url);
  const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map<number, (result: unknown) => void>();
  socket.onmessage = (event) => {
    const response = JSON.parse(String(event.data));
    pending.get(response.id)?.(response.result);
    pending.delete(response.id);
  };
  return {
    socket,
    closed,
    send(method: string): Promise<unknown> {
      return new Promise((resolve) => {
        pending.set(++id, resolve);
        socket.send(JSON.stringify({ id, method }));
      });
    },
  };
}

describe.skipIf(process.platform === "win32")("client loss without heartbeat", () => {
  it.each([
    { keepAlive: false, initialize: true, closeInstance: false, signal: "SIGINT" as const },
    { keepAlive: false, initialize: false, closeInstance: false, signal: "SIGKILL" as const },
    { keepAlive: false, initialize: true, closeInstance: true, signal: "SIGKILL" as const },
    { keepAlive: true, initialize: true, closeInstance: false, signal: "SIGKILL" as const },
  ])(
    "handles client loss %j",
    async ({ keepAlive, initialize, closeInstance, signal }) => {
      const profile = await mkdtemp(path.join(tmpdir(), "stagehand-client-loss-"));
      const child = fork(childPath, {
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          LIFECYCLE_PROFILE: profile,
          LIFECYCLE_KEEP_ALIVE: String(keepAlive),
          LIFECYCLE_INITIALIZE: String(initialize),
          LIFECYCLE_CLOSE_INSTANCE: String(closeInstance),
        },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      let observer: Awaited<ReturnType<typeof connect>> | undefined;
      try {
        const { cdpUrl } = await message(child);
        observer = await connect(String(cdpUrl));
        // A paused client has not disconnected. It must never be mistaken for a
        // dead process because its JS timers cannot run.
        child.kill("SIGSTOP");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await observer.send("Browser.getVersion")).toHaveProperty("product");
        if (signal === "SIGINT") child.kill("SIGCONT");
        child.kill(signal);
        if (!keepAlive) {
          await Promise.race([
            observer.closed,
            new Promise<never>((_, reject) => {
              const timer = setTimeout(
                () => reject(new Error("Chrome survived client death")),
                5000,
              );
              timer.unref();
            }),
          ]);
        } else {
          const browser = await localBrowser.connect({ cdpUrl: String(cdpUrl) });
          try {
            const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
            const pages = await browser.context.pages();
            expect(pages.length).toBeGreaterThan(0);
            expect(await Promise.all(pages.map((page) => page.title()))).toContain(
              "Stagehand reconnect witness",
            );
            expect(await Promise.all(pages.map((page) => page.url()))).not.toContain(
              "about:blank#stagehand-client-connection",
            );
            await stagehand.close();
          } finally {
            await browser.close();
          }
        }
      } finally {
        child.kill("SIGKILL");
        if (observer?.socket.readyState === WebSocket.OPEN) {
          void observer.send("Browser.close");
          await observer.closed;
        }
        observer?.socket.close();
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
    45_000,
  );

  it("intentional disconnect preserves an owned keepAlive=false browser", async () => {
    const browser = await localBrowser.launch({ headless: true });
    try {
      await Stagehand.create({ browser, logging: { level: "off" } });
      await browser.disconnect();
      await expect(browser.close()).rejects.toThrow("connect() again to close it");
      // The new handle owns closing it: Browser.close over its own connection.
      const reconnected = await localBrowser.connect({ cdpUrl: browser.cdpUrl! });
      try {
        const next = await Stagehand.create({ browser: reconnected, logging: { level: "off" } });
        expect((await reconnected.context.pages()).length).toBeGreaterThan(0);
        await next.close();
      } finally {
        await reconnected.close();
      }
    } finally {
      if (!browser.closed) await browser.close();
    }
  }, 45_000);

  it("does not terminate an externally launched Chrome when its client dies", async () => {
    const source = await launchLocalBrowser({ headless: true });
    const child = fork(childPath, {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, LIFECYCLE_CDP_URL: source.cdpUrl },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    try {
      const { cdpUrl } = await message(child);
      child.kill("SIGKILL");
      const browser = await localBrowser.connect({ cdpUrl: String(cdpUrl) });
      try {
        const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
        expect((await browser.context.pages()).length).toBeGreaterThan(0);
        await stagehand.close();
        await browser.disconnect();
      } finally {
        if (!browser.closed) await browser.disconnect();
      }
    } finally {
      child.kill("SIGKILL");
      await source.close();
    }
  }, 45_000);
});
