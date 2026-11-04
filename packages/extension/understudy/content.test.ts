import { runInNewContext } from "node:vm";
import { trace } from "@opentelemetry/api";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, type CDPSessionLike } from "./cdp.js";
import { Page } from "./page.js";

describe("Page.content", () => {
  const logger = new StagehandLogger({ tracer: trace.getTracer("content-test") }, () => {});
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
  const session: CDPSessionLike = {
    send: vi.fn(async () => ({})) as CDPSessionLike["send"],
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn(async () => {}),
    id: "session-1",
  };
  const page = new Page(connection, session, "page-1", "frame-1", logger);

  afterEach(() => vi.restoreAllMocks());
  afterAll(() => page.dispose());

  it.each([
    { doctype: "<!DOCTYPE html>", html: "<html><head></head><body>hello</body></html>" },
    { doctype: null, html: "<html><head></head><body></body></html>" },
    { doctype: "<!DOCTYPE html>", html: null },
    { doctype: null, html: null },
  ])("reads the main document in the locator world (%j)", async ({ doctype, html }) => {
    const evaluate = vi
      .spyOn(page.mainFrame(), "evaluateInLocatorWorld")
      .mockImplementation(async (buildExpression) =>
        runInNewContext(buildExpression(), {
          document: { doctype, documentElement: html === null ? null : { outerHTML: html } },
          XMLSerializer: class {
            serializeToString(value: string) {
              return value;
            }
          },
        }),
      );

    await expect(page.content()).resolves.toBe((doctype ?? "") + (html ?? ""));
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it("propagates evaluation errors instead of returning stale or empty content", async () => {
    const error = new Error("Target closed");
    vi.spyOn(page.mainFrame(), "evaluateInLocatorWorld").mockRejectedValue(error);
    await expect(page.content()).rejects.toBe(error);
  });
});
