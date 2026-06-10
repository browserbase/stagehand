import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";

/**
 * Unit tests for the `ignoreDefaultArgs` option in `launchLocalChrome`.
 *
 * Strategy: mock `chrome-launcher` and `ws` so `launchLocalChrome` returns
 * immediately, then assert the flags passed to `chrome-launcher.launch()`.
 */

const FAKE_WS_URL = "ws://127.0.0.1:9222/devtools/browser/fake";
const FAKE_CHROME_LAUNCHER_DEFAULTS = [
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--disable-background-networking",
  "--disable-sync",
  "--mute-audio",
];

vi.mock("chrome-launcher", () => ({
  launch: vi.fn().mockResolvedValue({
    port: 9222,
    kill: vi.fn(),
    pid: 12345,
  }),
  Launcher: {
    defaultFlags: () => [...FAKE_CHROME_LAUNCHER_DEFAULTS],
  },
}));

// Mock ws: the probe calls `new WebSocket(url)` then `.once("open", cb)`.
// Use EventEmitter so "open" fires after the listener is attached.
vi.mock("ws", async () => {
  const { EventEmitter } =
    await vi.importActual<typeof import("node:events")>("node:events");

  class MockWebSocket extends EventEmitter {
    constructor() {
      super();
      process.nextTick(() => this.emit("open"));
    }
    terminate() {}
  }
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

let launchMock: Mock;

beforeEach(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: FAKE_WS_URL }),
    }),
  );

  const chromeLauncher = await import("chrome-launcher");
  launchMock = chromeLauncher.launch as Mock;
  launchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function getLaunchArgs(
  opts: Record<string, unknown>,
): Promise<{ chromeFlags: string[]; ignoreDefaultFlags: boolean }> {
  const { launchLocalChrome } = await import("../../lib/v3/launch/local.js");
  await launchLocalChrome(opts);
  return launchMock.mock.calls[0][0];
}

describe("launchLocalChrome ignoreDefaultArgs", () => {
  it("does not set ignoreDefaultFlags when ignoreDefaultArgs is omitted", async () => {
    const args = await getLaunchArgs({});
    expect(args.ignoreDefaultFlags).toBe(false);
  });

  it("does not set ignoreDefaultFlags when ignoreDefaultArgs is false", async () => {
    const args = await getLaunchArgs({ ignoreDefaultArgs: false });
    expect(args.ignoreDefaultFlags).toBe(false);
  });

  it("sets ignoreDefaultFlags=true when ignoreDefaultArgs is true", async () => {
    const args = await getLaunchArgs({ ignoreDefaultArgs: true });
    expect(args.ignoreDefaultFlags).toBe(true);
    expect(args.chromeFlags).not.toContain("--remote-allow-origins=*");
    expect(args.chromeFlags).not.toContain("--no-first-run");
    // No chrome-launcher defaults should be prepended
    for (const flag of FAKE_CHROME_LAUNCHER_DEFAULTS) {
      expect(args.chromeFlags).not.toContain(flag);
    }
  });

  it("selectively removes only the listed flag", async () => {
    const args = await getLaunchArgs({
      ignoreDefaultArgs: ["--disable-extensions"],
    });

    expect(args.ignoreDefaultFlags).toBe(true);
    expect(args.chromeFlags).not.toContain("--disable-extensions");

    // Other defaults should be preserved (exact match, not substring)
    expect(args.chromeFlags).toContain(
      "--disable-component-extensions-with-background-pages",
    );
    expect(args.chromeFlags).toContain("--disable-background-networking");
    expect(args.chromeFlags).toContain("--disable-sync");
    expect(args.chromeFlags).toContain("--mute-audio");
  });

  it("uses exact matching, not substring matching", async () => {
    // "--disable-component" is a substring of
    // "--disable-component-extensions-with-background-pages",
    // but exact matching should NOT remove it
    const args = await getLaunchArgs({
      ignoreDefaultArgs: ["--disable-component"],
    });

    expect(args.chromeFlags).toContain(
      "--disable-component-extensions-with-background-pages",
    );
    expect(args.chromeFlags).toContain("--disable-extensions");
    expect(args.chromeFlags).toContain("--mute-audio");
  });

  it("uses exact matching for Stagehand defaults too", async () => {
    const args = await getLaunchArgs({
      ignoreDefaultArgs: ["--no-first"],
    });

    expect(args.chromeFlags).toContain("--no-first-run");
    expect(args.chromeFlags).toContain("--remote-allow-origins=*");
  });

  it("preserves all defaults when ignoreDefaultArgs is an empty array", async () => {
    const args = await getLaunchArgs({ ignoreDefaultArgs: [] });
    expect(args.ignoreDefaultFlags).toBe(false);
  });

  it("keeps Stagehand's own flags when selectively removing defaults", async () => {
    const args = await getLaunchArgs({
      ignoreDefaultArgs: ["--mute-audio"],
    });

    // Spot-check a couple of Stagehand's flags — not the full list,
    // so this test doesn't break if Stagehand adds/removes its own flags.
    expect(args.chromeFlags).toContain("--remote-allow-origins=*");
    expect(args.chromeFlags).toContain("--no-first-run");
    expect(args.chromeFlags).toContain(
      "--enable-features=WebMCPTesting,DevToolsWebMCPSupport",
    );

    expect(args.chromeFlags).not.toContain("--mute-audio");
    expect(args.chromeFlags).toContain("--disable-extensions");
  });

  it("merges user chromeFlags with re-added defaults", async () => {
    const args = await getLaunchArgs({
      args: ["--custom-flag"],
      ignoreDefaultArgs: ["--disable-sync"],
    });

    expect(args.chromeFlags).toContain("--custom-flag");
    expect(args.chromeFlags).not.toContain("--disable-sync");
    // Other defaults should still be present
    expect(args.chromeFlags).toContain("--disable-extensions");
  });

  it("does not deduplicate when user chromeFlags overlap with defaults", async () => {
    const args = await getLaunchArgs({
      args: ["--disable-sync"],
      ignoreDefaultArgs: ["--mute-audio"],
    });

    // "--disable-sync" appears in both user flags and re-added defaults
    const count = args.chromeFlags.filter((f) => f === "--disable-sync").length;
    expect(count).toBe(2);
  });

  it("selectively removes Stagehand defaults by exact match", async () => {
    const args = await getLaunchArgs({
      ignoreDefaultArgs: ["--no-first-run"],
    });

    expect(args.chromeFlags).not.toContain("--no-first-run");
    expect(args.chromeFlags).toContain("--remote-allow-origins=*");
    expect(args.chromeFlags).toContain("--disable-extensions");
  });

  it("allows users to disable the Stagehand --site-per-process default", async () => {
    const args = await getLaunchArgs({
      args: [
        "--disable-features=site-per-process,IsolateOrigins",
        "--renderer-process-limit=6",
      ],
      ignoreDefaultArgs: ["--site-per-process"],
    });

    expect(args.ignoreDefaultFlags).toBe(true);
    expect(args.chromeFlags).not.toContain("--site-per-process");
    expect(args.chromeFlags).toContain(
      "--disable-features=site-per-process,IsolateOrigins",
    );
    expect(args.chromeFlags).toContain("--renderer-process-limit=6");
    expect(args.chromeFlags).toContain("--remote-allow-origins=*");
  });
});
