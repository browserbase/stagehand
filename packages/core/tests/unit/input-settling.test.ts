import { describe, expect, it, vi } from "vitest";
import { Page } from "../../lib/v3/understudy/page.js";
import { Locator } from "../../lib/v3/understudy/locator.js";
import { waitForInputEventsToSettle } from "../../lib/v3/understudy/inputSettling.js";
import type {
  CdpConnection,
  CDPSessionLike,
} from "../../lib/v3/understudy/cdp.js";
import type { Frame } from "../../lib/v3/understudy/frame.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";

type PageTypeStub = {
  type: (
    text: string,
    options?: { delay?: number; withMistakes?: boolean },
  ) => Promise<void>;
};

type PageRuntimeConstructor = new (
  conn: CdpConnection,
  mainSession: MockCDPSession,
  targetId: string,
  mainFrameId: string,
) => PageTypeStub;

function makePage(session: MockCDPSession): PageTypeStub {
  const conn = {
    getTargets: async (): Promise<Array<{ targetId: string }>> => [],
  } as unknown as CdpConnection;
  const PageCtor = Page as unknown as PageRuntimeConstructor;
  return new PageCtor(conn, session, "target-1", "main-frame");
}

function makeLocator(session: MockCDPSession): Locator {
  const frame = { session: session as unknown as CDPSessionLike } as Frame;
  const locator = new Locator(frame, "xpath=//input");
  vi.spyOn(locator, "resolveNode").mockResolvedValue({
    nodeId: 1,
    objectId: "input-node",
  });
  return locator;
}

describe("input settling", () => {
  it("settles after Page.type dispatches the final key event", async () => {
    const session = new MockCDPSession();
    const page = makePage(session);

    await page.type("ab");

    const methods = session.calls.map((call) => call.method);
    expect(
      methods.filter((method) => method === "Input.dispatchKeyEvent"),
    ).toHaveLength(4);
    expect(methods.at(-1)).toBe("Runtime.evaluate");

    const settleCall = session.callsFor("Runtime.evaluate")[0]?.params;
    expect(settleCall).toMatchObject({
      awaitPromise: true,
      returnByValue: true,
    });
    expect(String(settleCall?.expression)).toContain("requestAnimationFrame");
  });

  it("settles after Locator.type inserts text before releasing the node", async () => {
    const session = new MockCDPSession();
    const locator = makeLocator(session);

    await locator.type("hello");

    expect(session.calls.map((call) => call.method)).toEqual([
      "Runtime.callFunctionOn",
      "Input.insertText",
      "Runtime.evaluate",
      "Runtime.releaseObject",
    ]);
  });

  it("settles after Locator.type delayed key events before releasing the node", async () => {
    const session = new MockCDPSession();
    const locator = makeLocator(session);

    await locator.type("ab", { delay: 1 });

    const methods = session.calls.map((call) => call.method);
    expect(
      methods.filter((method) => method === "Input.dispatchKeyEvent"),
    ).toHaveLength(4);
    expect(methods.at(-2)).toBe("Runtime.evaluate");
    expect(methods.at(-1)).toBe("Runtime.releaseObject");
  });

  it("does not fail typing when the settle context is destroyed by navigation", async () => {
    const session = new MockCDPSession({
      "Runtime.evaluate": () => {
        throw new Error("Execution context was destroyed");
      },
    });

    await expect(waitForInputEventsToSettle(session)).resolves.toBeUndefined();
  });

  it("does not fail Locator.type when navigation invalidates settle and cleanup", async () => {
    const session = new MockCDPSession({
      "Runtime.evaluate": () => {
        throw new Error("Execution context was destroyed");
      },
      "Runtime.releaseObject": () => {
        throw new Error("Cannot find context with specified id");
      },
    });
    const locator = makeLocator(session);

    await expect(locator.type("hello")).resolves.toBeUndefined();

    expect(session.calls.map((call) => call.method)).toEqual([
      "Runtime.callFunctionOn",
      "Input.insertText",
      "Runtime.evaluate",
      "Runtime.releaseObject",
    ]);
  });
});
