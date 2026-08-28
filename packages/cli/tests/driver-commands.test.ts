import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { elementsHandlers } from "../src/lib/driver/commands/elements.js";
import { keyboardHandlers } from "../src/lib/driver/commands/keyboard.js";
import { mouseHandlers } from "../src/lib/driver/commands/mouse.js";
import { navigationHandlers } from "../src/lib/driver/commands/navigation.js";
import { networkHandlers } from "../src/lib/driver/commands/network.js";
import { resolveSelector } from "../src/lib/driver/commands/selectors.js";
import { formatSnapshotTree } from "../src/lib/driver/commands/snapshot-format.js";
import { snapshotHandlers } from "../src/lib/driver/commands/snapshot.js";
import { runtimeHandlers } from "../src/lib/driver/commands/runtime.js";
import { tabHandlers } from "../src/lib/driver/commands/tabs.js";
import { DRIVER_COMMAND_NAMES } from "../src/lib/driver/commands/types.js";
import { hasExplicitDriverTarget } from "../src/lib/driver/command-cli.js";
import { getSocketPath } from "../src/lib/driver/daemon/paths.js";
import { parseRequest } from "../src/lib/driver/daemon/protocol.js";
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
      ).resolves.toEqual({
        kind: "remote",
      });
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
        {
          compact: true,
        },
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

  it("maps the CLI navigation timeout contract to the V4 page option", async () => {
    const page = { goto: vi.fn().mockResolvedValue(undefined) };
    const manager = {
      openResult: vi.fn().mockResolvedValue({ url: "https://example.com" }),
      pageForOpen: vi.fn().mockResolvedValue(page),
    } as unknown as Parameters<
      NonNullable<(typeof navigationHandlers)["open"]>
    >[0];

    await expect(
      navigationHandlers.open!(manager, {
        timeoutMs: 5_000,
        url: "https://example.com",
        waitUntil: "load",
      }),
    ).resolves.toEqual({ url: "https://example.com" });
    expect(page.goto).toHaveBeenCalledWith("https://example.com", {
      timeout: 5_000,
      waitUntil: "load",
    });
  });

  it("routes selector click and fill through V4 locators", async () => {
    const locator = {
      click: vi.fn(),
      fill: vi.fn(),
    };
    const page = {
      keyPress: vi.fn(),
      locator: vi.fn(() => locator),
    };
    const manager = {
      activePage: vi.fn(async () => page),
      resolveSelector: vi.fn((selector: string) =>
        selector === "@0-1" ? "/html/body/button" : selector,
      ),
    } as unknown as Parameters<
      NonNullable<(typeof elementsHandlers)["click"]>
    >[0];

    await expect(
      elementsHandlers.click!(manager, { selector: "@0-1" }),
    ).resolves.toEqual({
      clicked: true,
    });
    await expect(
      elementsHandlers.fill!(manager, {
        pressEnter: true,
        selector: "#email",
        value: "user@example.com",
      }),
    ).resolves.toEqual({ filled: true, pressedEnter: true });

    expect(page.locator).toHaveBeenNthCalledWith(1, "/html/body/button");
    expect(page.locator).toHaveBeenNthCalledWith(2, "#email");
    expect(locator.click).toHaveBeenCalledOnce();
    expect(locator.fill).toHaveBeenCalledWith("user@example.com");
    expect(page.keyPress).toHaveBeenCalledWith("Enter");
  });

  it("keeps select and highlight on V4 locators", async () => {
    const locator = {
      highlight: vi.fn(),
      selectOption: vi.fn().mockResolvedValue(["green", "blue"]),
    };
    const page = { locator: vi.fn(() => locator) };
    const manager = {
      activePage: vi.fn(async () => page),
      resolveSelector: vi.fn((selector: string) => selector),
    } as unknown as Parameters<
      NonNullable<(typeof elementsHandlers)["select"]>
    >[0];

    await expect(
      elementsHandlers.select!(manager, {
        selector: "#colors",
        values: ["green", "blue"],
      }),
    ).resolves.toEqual({ selected: ["green", "blue"] });
    await expect(
      elementsHandlers.highlight!(manager, {
        durationMs: 750,
        selector: "#colors",
      }),
    ).resolves.toEqual({ highlighted: true });

    expect(page.locator).toHaveBeenNthCalledWith(1, "#colors");
    expect(page.locator).toHaveBeenNthCalledWith(2, "#colors");
    expect(locator.selectOption).toHaveBeenCalledWith(["green", "blue"]);
    expect(locator.highlight).toHaveBeenCalledWith({ durationMs: 750 });
  });

  it("uploads files through the V4 locator API", async () => {
    const setInputFiles = vi.fn();
    const manager = {
      activePage: vi.fn(async () => ({
        locator: vi.fn(() => ({ setInputFiles })),
      })),
      resolveSelector: vi.fn((selector: string) => selector),
    } as unknown as Parameters<
      NonNullable<(typeof elementsHandlers)["upload"]>
    >[0];

    await expect(
      elementsHandlers.upload!(manager, {
        files: ["/tmp/file.txt"],
        selector: "input[type=file]",
      }),
    ).resolves.toEqual({ files: ["/tmp/file.txt"], uploaded: true });
    expect(setInputFiles).toHaveBeenCalledWith(["/tmp/file.txt"]);
  });

  it("omits undefined typing options from V4 requests", async () => {
    const page = { type: vi.fn() };
    const manager = {
      activePage: vi.fn(async () => page),
    } as unknown as Parameters<
      NonNullable<(typeof keyboardHandlers)["type"]>
    >[0];

    await expect(
      keyboardHandlers.type!(manager, { text: "plain" }),
    ).resolves.toEqual({
      typed: true,
    });
    await expect(
      keyboardHandlers.type!(manager, {
        delay: 25,
        mistakes: true,
        text: "human",
      }),
    ).resolves.toEqual({ typed: true });

    expect(page.type).toHaveBeenNthCalledWith(1, "plain", undefined);
    expect(page.type).toHaveBeenNthCalledWith(2, "human", {
      delay: 25,
      withMistakes: true,
    });
  });

  it("preserves supported coordinate mouse arguments on V4 pages", async () => {
    const page = {
      click: vi.fn(),
      dragAndDrop: vi.fn(),
      hover: vi.fn(),
      scroll: vi.fn(),
    };
    const manager = {
      activePage: vi.fn(async () => page),
    } as unknown as Parameters<
      NonNullable<(typeof mouseHandlers)["mouse.click"]>
    >[0];

    await expect(
      mouseHandlers["mouse.click"]!(manager, {
        button: "right",
        clickCount: 2,
        x: 10,
        y: 20,
      }),
    ).resolves.toEqual({ clicked: true });
    await expect(
      mouseHandlers["mouse.hover"]!(manager, { x: 30, y: 40 }),
    ).resolves.toEqual({
      hovered: true,
    });
    await expect(
      mouseHandlers["mouse.scroll"]!(manager, {
        deltaX: 5,
        deltaY: 500,
        x: 50,
        y: 60,
      }),
    ).resolves.toEqual({ scrolled: true });
    await expect(
      mouseHandlers["mouse.drag"]!(manager, {
        button: "left",
        delay: 25,
        fromX: 70,
        fromY: 80,
        steps: 4,
        toX: 90,
        toY: 100,
      }),
    ).resolves.toEqual({ dragged: true });

    expect(page.click).toHaveBeenCalledWith(10, 20, {
      button: "right",
      clickCount: 2,
    });
    expect(page.hover).toHaveBeenCalledWith(30, 40);
    expect(page.scroll).toHaveBeenCalledWith(50, 60, 5, 500);
    expect(page.dragAndDrop).toHaveBeenCalledWith(70, 80, 90, 100, {
      button: "left",
      delay: 25,
      steps: 4,
    });
  });

  it("omits undefined coordinate options from V4 requests", async () => {
    const page = {
      click: vi.fn(),
      dragAndDrop: vi.fn(),
      hover: vi.fn(),
      scroll: vi.fn(),
    };
    const manager = {
      activePage: vi.fn(async () => page),
    } as unknown as Parameters<
      NonNullable<(typeof mouseHandlers)["mouse.click"]>
    >[0];

    await mouseHandlers["mouse.click"]!(manager, { x: 10, y: 20 });
    await mouseHandlers["mouse.hover"]!(manager, { x: 30, y: 40 });
    await mouseHandlers["mouse.scroll"]!(manager, {
      deltaX: 5,
      deltaY: 500,
      x: 50,
      y: 60,
    });
    await mouseHandlers["mouse.drag"]!(manager, {
      fromX: 70,
      fromY: 80,
      toX: 90,
      toY: 100,
    });

    expect(page.click).toHaveBeenCalledWith(10, 20, {});
    expect(page.hover).toHaveBeenCalledWith(30, 40);
    expect(page.scroll).toHaveBeenCalledWith(50, 60, 5, 500);
    expect(page.dragAndDrop).toHaveBeenCalledWith(70, 80, 90, 100, {});
  });

  it("fails explicitly for the V4 coordinate XPath capability", async () => {
    const manager = {} as Parameters<
      NonNullable<(typeof mouseHandlers)["mouse.click"]>
    >[0];

    for (const [command, params] of [
      ["mouse.click", { returnXPath: true, x: 1, y: 2 }],
      ["mouse.hover", { returnXPath: true, x: 1, y: 2 }],
      ["mouse.scroll", { deltaX: 0, deltaY: 1, returnXPath: true, x: 1, y: 2 }],
      ["mouse.drag", { fromX: 1, fromY: 2, returnXPath: true, toX: 3, toY: 4 }],
    ] as const) {
      await expect(mouseHandlers[command]!(manager, params)).rejects.toThrow(
        "Coordinate XPath lookup is not exposed by Stagehand V4",
      );
    }
  });

  it("enables sidecar network capture and installs the CLI-owned cursor overlay", async () => {
    const page = { evaluate: vi.fn() };
    const network = {
      enable: vi.fn(async () => ({ enabled: true, path: "/tmp/network" })),
    };
    const manager = {
      activePage: vi.fn(async () => page),
      network,
      networkWebSocketDebuggerUrl: vi.fn(async () => "ws://sidecar.test"),
    } as unknown as Parameters<
      NonNullable<(typeof networkHandlers)["network.on"]>
    >[0];

    await expect(networkHandlers["network.on"]!(manager, {})).resolves.toEqual({
      enabled: true,
      path: "/tmp/network",
    });
    await expect(runtimeHandlers.cursor!(manager, {})).resolves.toEqual({
      enabled: true,
    });
    expect(network.enable).toHaveBeenCalledWith(page, "ws://sidecar.test");
    expect(page.evaluate).toHaveBeenCalledOnce();
    const cursorInstaller = page.evaluate.mock.calls[0]?.[0];
    expect(cursorInstaller).toEqual(expect.any(String));
    expect(cursorInstaller).toContain("__browse_cursor_overlay__");
    expect(cursorInstaller).toContain('"mousemove"');
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
    ).resolves.toEqual({
      waited: true,
    });
    expect(page.waitForTimeout).toHaveBeenCalledWith(100);
  });

  it("omits undefined screenshot options from V4 wire requests", async () => {
    const page = {
      screenshot: vi.fn().mockResolvedValue(Buffer.from("image")),
    };
    const manager = {
      activePage: async () => page,
    } as unknown as Parameters<
      NonNullable<(typeof runtimeHandlers)["screenshot"]>
    >[0];

    await expect(runtimeHandlers.screenshot!(manager, {})).resolves.toEqual({
      base64: Buffer.from("image").toString("base64"),
    });
    expect(page.screenshot).toHaveBeenCalledWith({ timeout: 10_000 });

    await runtimeHandlers.screenshot!(manager, {
      animations: "disabled",
      caret: "hide",
      clip: { height: 200, width: 300, x: 10, y: 20 },
      fullPage: true,
      quality: 80,
      type: "jpeg",
    });
    expect(page.screenshot).toHaveBeenLastCalledWith({
      animations: "disabled",
      caret: "hide",
      clip: { height: 200, width: 300, x: 10, y: 20 },
      fullPage: true,
      quality: 80,
      timeout: 10_000,
      type: "jpeg",
    });
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

type FakeTabPage = {
  close: ReturnType<typeof vi.fn>;
  pageId: string;
  title: () => Promise<string>;
  url: () => Promise<string>;
};

function createFakeTabManager(targetIds: string[], activeIndex: number) {
  let pages: FakeTabPage[] = [];
  let active: FakeTabPage | null = null;
  const makePage = (targetId: string): FakeTabPage => {
    const page: FakeTabPage = {
      close: vi.fn(async () => {
        pages = pages.filter((candidate) => candidate !== page);
      }),
      pageId: targetId,
      title: async () => targetId,
      url: async () => `https://example.com/${targetId}`,
    };
    return page;
  };

  pages = targetIds.map(makePage);
  active = pages[activeIndex] ?? null;
  const context = {
    activePage: async () => active,
    pages: async () => pages,
    setActivePage: vi.fn(async (page: FakeTabPage) => {
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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
