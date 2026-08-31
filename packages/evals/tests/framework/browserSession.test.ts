import { describe, expect, it } from "vitest";
import {
  browserSessionFromMetadata,
  buildBrowserSessionLogLines,
  withBrowserSession,
} from "../../framework/browserSession.js";

describe("browser session info", () => {
  it("reads runner-provided target metadata", () => {
    expect(
      browserSessionFromMetadata(
        {
          browserbaseSessionId: "abc-123",
          browserbaseSessionUrl: "https://www.browserbase.com/sessions/abc-123",
          browserbaseDebugUrl: "https://debug.example/abc-123",
        },
        "BROWSERBASE",
      ),
    ).toEqual({
      provider: "browserbase",
      sessionId: "abc-123",
      sessionUrl: "https://www.browserbase.com/sessions/abc-123",
      debugUrl: "https://debug.example/abc-123",
    });
  });

  it("derives the missing half of id/url from the other", () => {
    expect(browserSessionFromMetadata({ browserbaseSessionId: "abc" }, "BROWSERBASE")).toEqual({
      provider: "browserbase",
      sessionId: "abc",
      sessionUrl: "https://www.browserbase.com/sessions/abc",
    });
    expect(
      browserSessionFromMetadata(
        { browserbaseSessionUrl: "https://www.browserbase.com/sessions/xyz?tab=logs" },
        "BROWSERBASE",
      ),
    ).toMatchObject({ sessionId: "xyz" });
  });

  it("falls back to the bare provider", () => {
    expect(browserSessionFromMetadata({ browserbaseSessionId: "ignored" }, "LOCAL")).toEqual({
      provider: "local",
    });
    expect(browserSessionFromMetadata(undefined, "BROWSERBASE")).toEqual({
      provider: "browserbase",
    });
  });

  it("formats level-0 session lines", () => {
    expect(buildBrowserSessionLogLines({ provider: "local" })).toEqual([
      {
        category: "session",
        level: 0,
        message: "Browser: local",
        auxiliary: { provider: { value: "local", type: "string" } },
      },
    ]);
    expect(
      buildBrowserSessionLogLines({ provider: "browserbase" }).map((line) => line.message),
    ).toEqual(["Browser: browserbase (session id not reported by this surface)"]);
    expect(
      buildBrowserSessionLogLines({
        provider: "browserbase",
        sessionId: "abc",
        sessionUrl: "https://www.browserbase.com/sessions/abc",
        debugUrl: "https://debug.example/abc",
      }).map((line) => line.message),
    ).toEqual([
      "Browserbase session: https://www.browserbase.com/sessions/abc",
      "Browserbase debugger: https://debug.example/abc",
    ]);
  });

  it("stamps the task result without clobbering harness-reported urls", () => {
    expect(
      withBrowserSession(
        { _success: true, sessionUrl: "https://reported.example" },
        {
          provider: "browserbase",
          sessionId: "abc",
          sessionUrl: "https://www.browserbase.com/sessions/abc",
        },
      ),
    ).toEqual({
      _success: true,
      browserProvider: "browserbase",
      browserbaseSessionId: "abc",
      sessionUrl: "https://reported.example",
    });
  });
});
