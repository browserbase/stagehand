import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stagehandMocks = vi.hoisted(() => ({
  launch: vi.fn(),
}));
const browserbaseSdkMocks = vi.hoisted(() => ({
  debug: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", () => ({
  browserbase: { launch: stagehandMocks.launch },
}));
vi.mock("@browserbasehq/sdk", () => ({
  default: class Browserbase {
    sessions = { debug: browserbaseSdkMocks.debug };
  },
}));

import {
  launchRemoteBrowser,
  remoteBrowserbaseIdentity,
  remoteStagehandOptions,
  resolveExplicitRemoteTarget,
} from "../src/lib/driver/remote.js";

// The real Browserbase capability: --verified/--proxies must reach the
// session-create params so the cloud session is actually Verified/proxied,
// while keeping the browse_cli attribution tag that --cdp attach loses.
describe("remote.ts (Browserbase capability)", () => {
  const previousApiKey = process.env.BROWSERBASE_API_KEY;

  beforeEach(() => {
    stagehandMocks.launch.mockReset();
    browserbaseSdkMocks.debug.mockReset();
    process.env.BROWSERBASE_API_KEY = "test-key";
  });

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env.BROWSERBASE_API_KEY;
    } else {
      process.env.BROWSERBASE_API_KEY = previousApiKey;
    }
  });

  it("carries --verified/--proxies into the explicit remote target", () => {
    expect(resolveExplicitRemoteTarget({ remote: true })).toEqual({
      kind: "remote",
    });
    expect(
      resolveExplicitRemoteTarget({
        proxies: true,
        remote: true,
        verified: true,
      }),
    ).toEqual({ kind: "remote", proxies: true, verified: true });
  });

  // userMetadata content (browse_cli/cli_version/install_id) is owned and
  // verified by identity-attribution.test.ts; here we assert only that the
  // attribution tag survives and that --verified/--proxies are threaded.
  it("keeps the browse_cli tag and adds no session settings by default", async () => {
    const params = (await remoteStagehandOptions({ kind: "remote" })).browser;
    expect((params?.userMetadata as Record<string, string>).browse_cli).toBe("true");
    expect(params).not.toHaveProperty("proxies");
    expect(params).not.toHaveProperty("browserSettings");
  });

  it("threads proxies alone without touching browserSettings", async () => {
    const params = (await remoteStagehandOptions({ kind: "remote", proxies: true })).browser;
    expect(params?.proxies).toBe(true);
    expect(params).not.toHaveProperty("browserSettings");
  });

  it("threads verified alone into browserSettings without proxies", async () => {
    const params = (await remoteStagehandOptions({ kind: "remote", verified: true })).browser;
    expect(params?.browserSettings).toEqual({ verified: true });
    expect(params).not.toHaveProperty("proxies");
  });

  it("threads proxies and verified together into session-create params", async () => {
    const params = (
      await remoteStagehandOptions({
        kind: "remote",
        proxies: true,
        verified: true,
      })
    ).browser;
    expect(params?.proxies).toBe(true);
    expect(params?.browserSettings).toEqual({ verified: true });
  });

  it("requires an API key", async () => {
    delete process.env.BROWSERBASE_API_KEY;
    await expect(remoteStagehandOptions({ kind: "remote" })).rejects.toThrow(/BROWSERBASE_API_KEY/);
  });

  it("launches through the V4 Browserbase factory so the extension is provisioned", async () => {
    const browser = { close: vi.fn(), sessionId: "session-test" };
    stagehandMocks.launch.mockResolvedValue(browser);
    browserbaseSdkMocks.debug.mockResolvedValue({
      debuggerUrl: "https://www.browserbase.com/live/session-test",
    });

    await expect(
      launchRemoteBrowser({ kind: "remote", proxies: true, verified: true }),
    ).resolves.toEqual({
      browser,
      identity: {
        browserbaseDebugUrl: "https://www.browserbase.com/live/session-test",
        browserbaseSessionId: "session-test",
        browserbaseSessionUrl: "https://www.browserbase.com/sessions/session-test",
      },
    });
    expect(stagehandMocks.launch).toHaveBeenCalledWith({
      apiKey: "test-key",
      browserSettings: { verified: true },
      proxies: true,
      userMetadata: expect.objectContaining({ browse_cli: "true" }),
    });
  });

  it("preserves remote session and live-view output fields", async () => {
    const debug = async () => ({
      debuggerUrl: "https://www.browserbase.com/live/session-test",
    });

    await expect(
      remoteBrowserbaseIdentity(" session-test ", undefined, {
        sessions: { debug },
      }),
    ).resolves.toEqual({
      browserbaseDebugUrl: "https://www.browserbase.com/live/session-test",
      browserbaseSessionId: "session-test",
      browserbaseSessionUrl: "https://www.browserbase.com/sessions/session-test",
    });
  });
});
