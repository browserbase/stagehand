import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { elementsHandlers } from "../src/lib/driver/commands/elements.js";
import { keyboardHandlers } from "../src/lib/driver/commands/keyboard.js";
import { mouseHandlers } from "../src/lib/driver/commands/mouse.js";
import { navigationHandlers } from "../src/lib/driver/commands/navigation.js";
import { pageInfoHandlers } from "../src/lib/driver/commands/page-info.js";
import { resolveSelector } from "../src/lib/driver/commands/selectors.js";
import { formatSnapshotTree } from "../src/lib/driver/commands/snapshot-format.js";
import { snapshotHandlers } from "../src/lib/driver/commands/snapshot.js";
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

  it("keeps open available on the V4 foundation", async () => {
    const page = { goto: vi.fn() };
    const manager = {
      openResult: vi.fn(async () => ({ url: "https://example.com" })),
      pageForOpen: vi.fn(async () => page),
    } as unknown as Parameters<
      NonNullable<(typeof navigationHandlers)["open"]>
    >[0];

    await expect(
      navigationHandlers.open!(manager, {
        timeoutMs: 1_234,
        url: "https://example.com",
        waitUntil: "networkidle",
      }),
    ).resolves.toEqual({ url: "https://example.com" });
    expect(page.goto).toHaveBeenCalledWith("https://example.com", {
      timeout: 1_234,
      waitUntil: "networkidle",
    });
  });

  it("fails deferred standard commands with one stable result code", async () => {
    const deferred = [
      elementsHandlers.click,
      elementsHandlers.fill,
      elementsHandlers.select,
      keyboardHandlers.type,
      mouseHandlers["mouse.click"],
      mouseHandlers["mouse.drag"],
      navigationHandlers.back,
      navigationHandlers.reload,
      pageInfoHandlers.get,
      pageInfoHandlers.is,
      runtimeHandlers.screenshot,
      tabHandlers["tab.close"],
      tabHandlers["tab.new"],
    ];

    for (const handler of deferred) {
      await expect(handler!({} as never, {})).rejects.toMatchObject({
        code: "v4_command_unavailable",
      });
    }

    await expect(
      runtimeHandlers.cursor!({} as never, {}),
    ).rejects.toMatchObject({ code: "cursor_overlay_unavailable" });
    await expect(new NetworkCapture("gap").enable({})).rejects.toMatchObject({
      code: "network_capture_unavailable",
    });
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

  it("omits ref maps by default and includes them with --full", async () => {
    const snap = {
      formattedTree: "[0-1] RootWebArea: Test\n  [0-2] button: Go",
      urlMap: { "0-2": "https://example.com/go" },
      xpathMap: { "0-1": "/", "0-2": "/button[1]" },
    };
    const setRefMaps = vi.fn();
    const manager = {
      activePage: async () => ({ snapshot: async () => snap }),
      setRefMaps,
    } as unknown as Parameters<
      NonNullable<(typeof snapshotHandlers)["snapshot"]>
    >[0];

    const lean = await snapshotHandlers.snapshot!(manager, {});
    expect(lean).not.toHaveProperty("xpathMap");
    expect(lean).not.toHaveProperty("urlMap");
    expect(setRefMaps).toHaveBeenCalledTimes(1);
    expect(setRefMaps).toHaveBeenLastCalledWith({
      urlMap: snap.urlMap,
      xpathMap: snap.xpathMap,
    });

    const full = await snapshotHandlers.snapshot!(manager, { full: true });
    expect(full).toMatchObject({
      urlMap: snap.urlMap,
      xpathMap: snap.xpathMap,
    });
    expect(setRefMaps).toHaveBeenCalledTimes(2);
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
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
