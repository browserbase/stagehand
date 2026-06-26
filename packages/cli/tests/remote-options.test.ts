import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  remoteStagehandOptions,
  resolveExplicitRemoteTarget,
} from "../src/lib/driver/remote.js";

// The real Browserbase capability: --verified/--proxies must reach the
// session-create params so the cloud session is actually Verified/proxied,
// while keeping the browse_cli attribution tag that --cdp attach loses.
describe("remote.ts (Browserbase capability)", () => {
  const previousApiKey = process.env.BROWSERBASE_API_KEY;

  beforeEach(() => {
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

  it("keeps the browse_cli tag and adds no session settings by default", () => {
    const options = remoteStagehandOptions({ kind: "remote" });
    expect(options.browserbaseSessionCreateParams).toEqual({
      userMetadata: { browse_cli: "true" },
    });
  });

  it("threads proxies and verified into session-create params", () => {
    const options = remoteStagehandOptions({
      kind: "remote",
      proxies: true,
      verified: true,
    });
    expect(options.browserbaseSessionCreateParams).toEqual({
      browserSettings: { verified: true },
      proxies: true,
      userMetadata: { browse_cli: "true" },
    });
  });

  it("requires an API key", () => {
    delete process.env.BROWSERBASE_API_KEY;
    expect(() => remoteStagehandOptions({ kind: "remote" })).toThrow(
      /BROWSERBASE_API_KEY/,
    );
  });
});
