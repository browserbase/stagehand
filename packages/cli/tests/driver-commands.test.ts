import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveSelector } from "../src/lib/driver/commands/selectors.js";
import { formatSnapshotTree } from "../src/lib/driver/commands/snapshot-format.js";
import { runtimeHandlers } from "../src/lib/driver/commands/runtime.js";
import { tabHandlers } from "../src/lib/driver/commands/tabs.js";
import { DRIVER_COMMAND_NAMES } from "../src/lib/driver/commands/types.js";
import { hasExplicitDriverTarget } from "../src/lib/driver/command-cli.js";
import { getSocketPath } from "../src/lib/driver/daemon/paths.js";
import { parseRequest } from "../src/lib/driver/daemon/protocol.js";
import { NetworkCapture } from "../src/lib/driver/network-capture.js";
import { runCli } from "./helpers/run-cli.js";

describe("driver commands", () => {
  it("registers the native driver command handlers without legacy underscore aliases", () => {
    expect([...DRIVER_COMMAND_NAMES].sort()).toEqual(
      expect.arrayContaining([
        "click",
        "mouse.click",
        "snapshot",
        "tab.switch",
        "network.on",
        "upload",
        "viewport",
      ]),
    );
    expect([...DRIVER_COMMAND_NAMES]).not.toEqual(
      expect.arrayContaining([
        "click_xy",
        "tab_switch",
        "tab_close",
        "network_enable",
      ]),
    );
  });

  it("resolves snapshot refs while leaving normal selectors unchanged", () => {
    const maps = {
      urlMap: { "0-2": "https://example.com" },
      xpathMap: { "0-1": "/html/body/button" },
    };

    expect(resolveSelector("@0-1", maps)).toBe("/html/body/button");
    expect(resolveSelector("[0-1]", maps)).toBe("/html/body/button");
    expect(resolveSelector("button[type=submit]", maps)).toBe(
      "button[type=submit]",
    );
    expect(() => resolveSelector("@9-9", maps)).toThrow('Unknown ref "9-9"');
  });

  it("treats headed and headless as explicit local target choices", () => {
    expect(hasExplicitDriverTarget({})).toBe(false);
    expect(hasExplicitDriverTarget({ local: true })).toBe(true);
    expect(hasExplicitDriverTarget({ headed: true })).toBe(true);
    expect(hasExplicitDriverTarget({ headless: true })).toBe(true);
    expect(hasExplicitDriverTarget({ cdp: "9222" })).toBe(true);
    expect(
      hasExplicitDriverTarget({
        "chrome-arg": ["--no-focus-on-navigate"],
      }),
    ).toBe(true);
    expect(
      hasExplicitDriverTarget({
        "ignore-default-chrome-arg": ["--enable-automation"],
      }),
    ).toBe(true);
    expect(hasExplicitDriverTarget({ "no-default-chrome-args": true })).toBe(
      true,
    );
  });

  it("reuses an existing daemon when a broad mode flag matches", async () => {
    vi.resetModules();
    const getDriverStatus = vi.fn().mockResolvedValue({
      target: { headless: false, kind: "managed-local" },
    });
    vi.doMock("../src/lib/driver/daemon/client.js", () => ({
      getDriverStatus,
    }));

    try {
      const { resolveTargetForCommand } = await import(
        "../src/lib/driver/command-cli.js"
      );

      await expect(
        resolveTargetForCommand("reuse-local", { local: true }),
      ).resolves.toEqual({
        headless: false,
        kind: "managed-local",
      });
      await expect(
        resolveTargetForCommand("reuse-local", { headless: true, local: true }),
      ).resolves.toEqual({
        headless: true,
        kind: "managed-local",
      });
      await expect(
        resolveTargetForCommand("reuse-local", { remote: true }),
      ).resolves.toEqual({ kind: "remote" });
    } finally {
      vi.doUnmock("../src/lib/driver/daemon/client.js");
      vi.resetModules();
    }
  });

  it("routes CDP targets through the daemon so session state persists", async () => {
    vi.resetModules();
    const ensureDriverDaemon = vi.fn().mockResolvedValue(undefined);
    const openViaDaemon = vi
      .fn()
      .mockResolvedValue({ url: "https://example.com" });
    const runDriverCommandViaDaemon = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("../src/lib/driver/daemon/client.js", () => ({
      ensureDriverDaemon,
      openViaDaemon,
      runDriverCommandViaDaemon,
    }));

    try {
      const { runDriverCommandWithTarget } = await import(
        "../src/lib/driver/runtime.js"
      );
      const target = {
        endpoint: "ws://127.0.0.1:9222/devtools/browser/test",
        kind: "cdp" as const,
        targetId: "target-1",
      };
      await expect(
        runDriverCommandWithTarget("cdp-state", target, "snapshot", {
          compact: true,
        }),
      ).resolves.toEqual({
        ok: true,
      });

      expect(ensureDriverDaemon).toHaveBeenCalledWith({
        session: "cdp-state",
        target,
      });
      expect(runDriverCommandViaDaemon).toHaveBeenCalledWith(
        "cdp-state",
        "snapshot",
        { compact: true },
      );
      expect(openViaDaemon).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../src/lib/driver/daemon/client.js");
      vi.resetModules();
    }
  });

  it("rejects unknown daemon command names at the protocol boundary", () => {
    expect(() =>
      parseRequest(
        JSON.stringify({ command: "snapshot", id: "1", type: "command" }),
      ),
    ).not.toThrow();
    expect(() =>
      parseRequest(
        JSON.stringify({ command: "not.real", id: "1", type: "command" }),
      ),
    ).toThrow();
  });

  it("selects a remaining tab after closing the active tab", async () => {
    const tabs = createFakeTabManager(["tab-1", "tab-2", "tab-3"], 1);

    await expect(tabHandlers["tab.close"]!(tabs.manager, {})).resolves.toEqual({
      closed: true,
      index: 1,
      selectedTargetId: "tab-3",
      targetId: "tab-2",
    });
    expect(tabs.pages[1]!.close).toHaveBeenCalledOnce();
    expect(tabs.context.setActivePage).toHaveBeenCalledWith(tabs.pages[2]);
    expect(tabs.active).toBe(tabs.pages[2]);
  });

  it("preserves the active tab after closing a non-active tab", async () => {
    const tabs = createFakeTabManager(["tab-1", "tab-2", "tab-3"], 0);

    await expect(
      tabHandlers["tab.close"]!(tabs.manager, { tab: "tab-2" }),
    ).resolves.toEqual({
      closed: true,
      index: 1,
      selectedTargetId: "tab-1",
      targetId: "tab-2",
    });
    expect(tabs.pages[1]!.close).toHaveBeenCalledOnce();
    expect(tabs.context.setActivePage).not.toHaveBeenCalled();
    expect(tabs.active).toBe(tabs.pages[0]);
  });

  it("rejects invalid wait timeout values before calling the page", async () => {
    const page = { waitForTimeout: vi.fn() };
    const manager = {
      activePage: async () => page,
    } as unknown as Parameters<
      NonNullable<(typeof runtimeHandlers)["wait"]>
    >[0];

    await expect(
      runtimeHandlers.wait!(manager, { arg: "100abc", type: "timeout" }),
    ).rejects.toThrow("wait timeout requires a non-negative integer");
    await expect(
      runtimeHandlers.wait!(manager, { arg: "-1", type: "timeout" }),
    ).rejects.toThrow("wait timeout requires a non-negative integer");
    expect(page.waitForTimeout).not.toHaveBeenCalled();

    await expect(
      runtimeHandlers.wait!(manager, { arg: "100", type: "timeout" }),
    ).resolves.toEqual({ waited: true });
    expect(page.waitForTimeout).toHaveBeenCalledWith(100);
  });

  it("accepts fractional viewport scale values", async () => {
    const daemonDir = await fs.mkdtemp(
      join(tmpdir(), "browse-viewport-scale-"),
    );
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const session = "viewport-scale";
    const requests: Array<{
      command?: string;
      id: string;
      params?: unknown;
      type: string;
    }> = [];
    const server = net.createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;

        const request = JSON.parse(buffer.slice(0, newline)) as {
          command?: string;
          id: string;
          params?: unknown;
          type: string;
        };
        requests.push(request);

        if (request.type === "status") {
          socket.end(
            JSON.stringify({
              data: {
                browserConnected: true,
                initialized: true,
                mode: "managed-local",
                pages: [],
                pid: process.pid,
                session,
                target: { headless: true, kind: "managed-local" },
              },
              id: request.id,
              type: "success",
            }) + "\n",
          );
          return;
        }

        socket.end(
          JSON.stringify({
            data: { ok: true },
            id: request.id,
            type: "success",
          }) + "\n",
        );
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(getSocketPath(session), resolve);
      });

      const result = await runCli(
        ["viewport", "1024", "768", "--scale", "1.5", "--session", session],
        {
          env: { BROWSE_DAEMON_DIR: daemonDir },
        },
      );
      expect(result.exitCode).toBe(0);
      expect(
        requests.find((request) => request.type === "command"),
      ).toMatchObject({
        command: "viewport",
        params: { height: 768, scale: 1.5, width: 1024 },
      });
    } finally {
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await fs.rm(daemonDir, { recursive: true, force: true });
    }
  });

  it("filters and trims snapshot output without changing ref syntax", () => {
    const tree = [
      "- page:",
      "  - navigation:",
      "    - link [0-1]: Home",
      "  - main:",
      "    - button [0-2]: Submit order",
      "      - text: nested",
    ].join("\n");

    expect(formatSnapshotTree(tree, { filter: "submit" })).toBe(
      ["- page:", "  - main:", "    - button [0-2]: Submit order"].join("\n"),
    );
    expect(formatSnapshotTree(tree, { maxDepth: 2 })).toBe(
      [
        "- page:",
        "  - navigation:",
        "    - link [0-1]: Home",
        "  - main:",
        "    - button [0-2]: Submit order",
      ].join("\n"),
    );
  });

  it("exposes descriptive help for the new driver command surface", async () => {
    const commands = [
      ["open"],
      ["snapshot"],
      ["click"],
      ["mouse", "click"],
      ["tab", "switch"],
      ["network", "on"],
      ["get"],
      ["screenshot"],
      ["cdp"],
    ];

    for (const command of commands) {
      const result = await runCli([...command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("DESCRIPTION");
      expect(result.stdout).toContain("EXAMPLES");
    }
  });

  it("documents targetId as the stable tab selector in tab help", async () => {
    const result = await runCli(["tab", "switch", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Prefer targetId");
  });

  it("keeps network responses when loading finishes before request file writes", async () => {
    const daemonDir = await fs.mkdtemp(join(tmpdir(), "browse-network-race-"));
    const previousDaemonDir = process.env.BROWSE_DAEMON_DIR;
    process.env.BROWSE_DAEMON_DIR = daemonDir;
    const cdp = new FakeCdpSession();
    const capture = new NetworkCapture("race");
    const originalWriteFile = fs.writeFile.bind(fs);
    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockImplementation(async (...args) => {
        if (String(args[0]).endsWith("request.json")) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return originalWriteFile(...args);
      });

    try {
      await capture.enable({ mainFrame: () => ({ session: cdp }) });
      cdp.emit("Network.requestWillBeSent", {
        request: {
          headers: {},
          method: "GET",
          url: "https://example.com/fast",
        },
        requestId: "req-1",
        type: "Document",
      });
      cdp.emit("Network.responseReceived", {
        requestId: "req-1",
        response: {
          headers: { "content-type": "text/plain" },
          mimeType: "text/plain",
          status: 200,
          statusText: "OK",
        },
      });
      cdp.emit("Network.loadingFinished", { requestId: "req-1" });

      const responsePath = join(
        daemonDir,
        "race-network",
        "000-GET-example.com-fast",
        "response.json",
      );
      await waitForFile(responsePath);
      if (process.platform !== "win32") {
        const networkDir = join(daemonDir, "race-network");
        const requestDir = join(networkDir, "000-GET-example.com-fast");
        expect(await fileMode(networkDir)).toBe(0o700);
        expect(await fileMode(requestDir)).toBe(0o700);
        expect(await fileMode(join(requestDir, "request.json"))).toBe(0o600);
        expect(await fileMode(responsePath)).toBe(0o600);
      }
      const response = JSON.parse(await fs.readFile(responsePath, "utf8")) as {
        body: string;
        status: number;
      };
      expect(response).toMatchObject({ body: "ok", status: 200 });
    } finally {
      writeFileSpy.mockRestore();
      restoreEnv("BROWSE_DAEMON_DIR", previousDaemonDir);
      await fs.rm(daemonDir, { recursive: true, force: true });
    }
  });
});

class FakeCdpSession {
  private readonly listeners = new Map<
    string,
    Array<(params: unknown) => void>
  >();

  async send<T = unknown>(method: string): Promise<T> {
    if (method === "Network.getResponseBody") {
      return { body: "ok" } as T;
    }
    return {} as T;
  }

  on(event: string, listener: (params: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (params: unknown) => void): void {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter(
        (candidate) => candidate !== listener,
      ),
    );
  }

  emit(event: string, params: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(params);
    }
  }
}

type FakeTabPage = {
  close: ReturnType<typeof vi.fn>;
  targetId: () => string;
  title: () => Promise<string>;
  url: () => string;
};

function createFakeTabManager(targetIds: string[], activeIndex: number) {
  let pages: FakeTabPage[] = [];
  let active: FakeTabPage | null = null;
  const makePage = (targetId: string): FakeTabPage => {
    const page: FakeTabPage = {
      close: vi.fn(async () => {
        pages = pages.filter((candidate) => candidate !== page);
      }),
      targetId: () => targetId,
      title: async () => targetId,
      url: () => `https://example.com/${targetId}`,
    };
    return page;
  };

  pages = targetIds.map(makePage);
  active = pages[activeIndex] ?? null;
  const context = {
    activePage: () => active,
    pages: () => pages,
    setActivePage: vi.fn((page: FakeTabPage) => {
      active = page;
    }),
  };

  return {
    get active() {
      return active;
    },
    context,
    manager: {
      browserContext: async () => context,
      safeTitle: async (page: FakeTabPage) => page.title(),
    } as unknown as Parameters<
      NonNullable<(typeof tabHandlers)["tab.close"]>
    >[0],
    pages,
  };
}

async function waitForFile(path: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 1000) {
    try {
      await fs.access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function fileMode(path: string): Promise<number> {
  return (await fs.stat(path)).mode & 0o777;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
