import { trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import { Page } from "./page.js";

function fakeSession(id: string) {
  const send = vi.fn(async (_method: string, _params?: object): Promise<unknown> => ({}));
  const session: CDPSessionLike = {
    send: send as CDPSessionLike["send"],
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(async () => {}),
    id,
  };
  return { session, send };
}

function callsTo(send: ReturnType<typeof fakeSession>["send"], method: string) {
  return send.mock.calls.filter(([name]) => name === method).map(([, params]) => params);
}

describe("Page session overrides", () => {
  let page: Page;
  let main: ReturnType<typeof fakeSession>;
  let logger: StagehandLogger;

  beforeEach(() => {
    logger = new StagehandLogger({ tracer: trace.getTracer("session-overrides-test") }, () => {});
    const connection = new CdpConnection(
      {
        connected: true,
        send: vi.fn(),
        close: vi.fn(async () => {}),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
      logger,
    );
    main = fakeSession("session-1");
    page = new Page(connection, main.session, "page-1", "frame-1", logger);
    main.send.mockClear();
  });

  afterEach(() => {
    page.dispose();
    vi.restoreAllMocks();
  });

  it("merges media options and clears one with no-override", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.emulateMedia({ colorScheme: "no-override" });
    await page.emulateMedia();

    expect(callsTo(main.send, "Emulation.setEmulatedMedia")).toStrictEqual([
      { features: [{ name: "prefers-color-scheme", value: "dark" }] },
      {
        features: [
          { name: "prefers-color-scheme", value: "dark" },
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      },
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
    ]);
  });

  it("overrides the user agent, including the empty default", async () => {
    await page.setUserAgent("StagehandTest/1.0");
    await page.setUserAgent("");

    expect(callsTo(main.send, "Emulation.setUserAgentOverride")).toStrictEqual([
      { userAgent: "StagehandTest/1.0" },
      { userAgent: "" },
    ]);
  });

  it("applies overrides to existing child sessions and re-applies them to adopted ones", async () => {
    const existing = fakeSession("child-1");
    page.adoptOopifSession(existing.session, "child-frame-1");

    await page.emulateMedia({ colorScheme: "light" });
    await page.setUserAgent("StagehandTest/1.0");

    expect(callsTo(existing.send, "Emulation.setEmulatedMedia")).toStrictEqual([
      { features: [{ name: "prefers-color-scheme", value: "light" }] },
    ]);
    expect(callsTo(existing.send, "Emulation.setUserAgentOverride")).toStrictEqual([
      { userAgent: "StagehandTest/1.0" },
    ]);

    const adopted = fakeSession("child-2");
    page.adoptOopifSession(adopted.session, "child-frame-2");

    expect(callsTo(adopted.send, "Emulation.setEmulatedMedia")).toStrictEqual([
      { features: [{ name: "prefers-color-scheme", value: "light" }] },
    ]);
    expect(callsTo(adopted.send, "Emulation.setUserAgentOverride")).toStrictEqual([
      { userAgent: "StagehandTest/1.0" },
    ]);
  });

  it("does not touch adopted sessions when nothing was overridden", () => {
    const adopted = fakeSession("child-1");
    page.adoptOopifSession(adopted.session, "child-frame-1");

    expect(callsTo(adopted.send, "Emulation.setEmulatedMedia")).toStrictEqual([]);
    expect(callsTo(adopted.send, "Emulation.setUserAgentOverride")).toStrictEqual([]);
  });

  it("applies extra HTTP headers to every session", async () => {
    const child = fakeSession("child-1");
    page.adoptOopifSession(child.session, "child-frame-1");

    await page.setExtraHTTPHeaders({ "x-test": "true" });

    for (const { send } of [main, child]) {
      expect(callsTo(send, "Network.setExtraHTTPHeaders")).toContainEqual({
        headers: { "x-test": "true" },
      });
    }
  });

  it("logs every failed session and rethrows the first original CDP error", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    const child = fakeSession("child-1");
    page.adoptOopifSession(child.session, "child-frame-1");
    const mainFailure = new Error("main failed");
    main.send.mockRejectedValueOnce(mainFailure);
    child.send.mockRejectedValueOnce(new Error("child failed"));

    await expect(page.setUserAgent("StagehandTest/1.0")).rejects.toBe(mainFailure);
    expect(error).toHaveBeenCalledWith("setUserAgent failed for one or more sessions", {
      category: "page",
      failures: [
        { sessionId: "session-1", message: "main failed" },
        { sessionId: "child-1", message: "child failed" },
      ],
    });
  });
});
