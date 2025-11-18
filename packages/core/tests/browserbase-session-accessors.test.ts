import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { V3 } from "../lib/v3/v3";

const MOCK_SESSION_ID = "session-123";
const MOCK_SESSION_URL = `https://www.browserbase.com/sessions/${MOCK_SESSION_ID}`;
const MOCK_DEBUG_URL = `https://debug.browserbase.com/${MOCK_SESSION_ID}`;

vi.mock("../lib/v3/understudy/context", () => {
  class MockConnection {
    onTransportClosed = vi.fn();
    offTransportClosed = vi.fn();
    send = vi.fn(async () => {});
  }

  class MockV3Context {
    static async create(): Promise<MockV3Context> {
      return new MockV3Context();
    }

    conn = new MockConnection();

    pages(): never[] {
      return [];
    }

    async close(): Promise<void> {
      // noop
    }
  }

  return { V3Context: MockV3Context };
});

vi.mock("../lib/v3/launch/browserbase", () => ({
  createBrowserbaseSession: vi.fn(async () => ({
    ws: "wss://mock-browserbase",
    sessionId: MOCK_SESSION_ID,
    bb: {
      sessions: {
        debug: vi.fn(async () => ({ debuggerUrl: MOCK_DEBUG_URL })),
      },
    },
  })),
}));

vi.mock("../lib/v3/launch/local", () => ({
  launchLocalChrome: vi.fn(async () => ({
    ws: "ws://local-cdp",
    chrome: { kill: vi.fn(async () => {}) },
  })),
}));

describe("browserbase accessors", () => {
  beforeEach(() => {
    process.env.BROWSERBASE_API_KEY = "fake-key";
    process.env.BROWSERBASE_PROJECT_ID = "fake-project";
  });

  afterEach(() => {
    delete process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_PROJECT_ID;
    vi.clearAllMocks();
  });

  it("exposes Browserbase session and debug URLs after init", async () => {
    const v3 = new V3({
      env: "BROWSERBASE",
      disableAPI: true,
      verbose: 0,
    });

    try {
      await v3.init();

      expect(v3.browserbaseSessionURL).toBe(MOCK_SESSION_URL);
      expect(v3.browserbaseDebugURL).toBe(MOCK_DEBUG_URL);
    } finally {
      await v3.close().catch(() => {});
    }
  });

  it("clears stored URLs after close", async () => {
    const v3 = new V3({
      env: "BROWSERBASE",
      disableAPI: true,
      verbose: 0,
    });

    await v3.init();
    await v3.close();

    expect(v3.browserbaseSessionURL).toBeUndefined();
    expect(v3.browserbaseDebugURL).toBeUndefined();
  });
});

describe("local accessors", () => {
  it("stay empty for LOCAL environments", async () => {
    const v3 = new V3({
      env: "LOCAL",
      disableAPI: true,
      verbose: 0,
      localBrowserLaunchOptions: {
        cdpUrl: "ws://local-existing-session",
      },
    });

    try {
      await v3.init();
      expect(v3.browserbaseSessionURL).toBeUndefined();
      expect(v3.browserbaseDebugURL).toBeUndefined();
    } finally {
      await v3.close().catch(() => {});
    }
  });
});
